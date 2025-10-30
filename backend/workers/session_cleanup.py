"""
Session Cleanup Worker

Background worker that periodically cleans up expired login sessions
and closes associated browser contexts.
"""

import threading
import time
from typing import Optional
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class SessionCleanupWorker:
    """
    Background worker that periodically cleans up expired login sessions.
    
    Runs in a separate thread and automatically terminates browser contexts
    for sessions that have exceeded their timeout.
    """
    
    def __init__(self, session_manager, cleanup_interval: int = 60):
        """
        Initialize the session cleanup worker.
        
        Args:
            session_manager: LoginSessionManager instance
            cleanup_interval: Time between cleanup runs in seconds (default: 60)
        """
        self.session_manager = session_manager
        self.cleanup_interval = cleanup_interval
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._running = False
        
        logger.info(f"SessionCleanupWorker initialized with {cleanup_interval}s interval")
    
    def start(self) -> None:
        """Start the cleanup worker in a background thread."""
        if self._running:
            logger.warning("Session cleanup worker is already running")
            return
        
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        self._running = True
        
        logger.info("Session cleanup worker started")
    
    def stop(self, timeout: int = 5) -> None:
        """
        Stop the cleanup worker gracefully.
        
        Args:
            timeout: Maximum time to wait for worker to stop (seconds)
        """
        if not self._running:
            logger.warning("Session cleanup worker is not running")
            return
        
        logger.info("Stopping session cleanup worker...")
        self._stop_event.set()
        
        if self._thread:
            self._thread.join(timeout=timeout)
            if self._thread.is_alive():
                logger.warning("Session cleanup worker did not stop cleanly")
            else:
                logger.info("Session cleanup worker stopped")
        
        self._running = False
    
    def is_running(self) -> bool:
        """Check if the worker is currently running."""
        return self._running
    
    def _run(self) -> None:
        """
        Main worker loop.
        
        Runs continuously until stop() is called, cleaning up expired sessions
        at each interval.
        """
        logger.info("Session cleanup worker loop started")
        
        while not self._stop_event.is_set():
            try:
                # Perform cleanup
                cleaned_count = self.session_manager.cleanup_expired_sessions()
                
                if cleaned_count > 0:
                    logger.info(f"Cleaned up {cleaned_count} expired session(s)")
                
                # Get current session count for monitoring
                active_count = self.session_manager.get_session_count()
                if active_count > 0:
                    logger.debug(f"Active sessions: {active_count}")
                
            except Exception as e:
                logger.error(f"Error during session cleanup: {e}", exc_info=True)
            
            # Wait for next interval or stop signal
            self._stop_event.wait(timeout=self.cleanup_interval)
        
        logger.info("Session cleanup worker loop ended")
    
    def force_cleanup(self) -> int:
        """
        Force an immediate cleanup run (useful for testing or manual cleanup).
        
        Returns:
            Number of sessions cleaned up
        """
        logger.info("Forcing immediate session cleanup")
        try:
            return self.session_manager.cleanup_expired_sessions()
        except Exception as e:
            logger.error(f"Error during forced cleanup: {e}")
            return 0

