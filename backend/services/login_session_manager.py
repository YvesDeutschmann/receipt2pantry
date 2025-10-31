"""
Login Session Manager for MFA Flow

Manages active login sessions that require multi-factor authentication.
Tracks browser contexts, pages, and provider instances for resumable login flows.
"""

import uuid
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Dict, Optional
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class LoginSessionManager:
    """
    Thread-safe manager for login sessions requiring MFA.
    
    Sessions are stored in-memory and automatically cleaned up after expiration.
    Each session maintains a browser context to allow resuming the login flow
    after the user provides their MFA code.
    """
    
    def __init__(self, default_timeout: int = 300):
        """
        Initialize the session manager.
        
        Args:
            default_timeout: Default session timeout in seconds (default: 300 = 5 minutes)
        """
        self._sessions: Dict[str, Dict] = {}
        self._lock = Lock()
        self._default_timeout = default_timeout
        logger.info(f"LoginSessionManager initialized with {default_timeout}s timeout")
    
    def create_session(
        self,
        user_id: str,
        provider: str,
        browser_context,
        page=None,  # Make page optional
        provider_instance=None
    ) -> str:
        """
        Create a new login session.
        
        Args:
            user_id: User ID owning this session
            provider: Provider name (e.g., "safeway")
            browser_context: Playwright browser context
            page: Playwright page object (optional, not stored to avoid thread issues)
            provider_instance: Provider instance (e.g., SafewayProvider)
            
        Returns:
            Session ID (UUID)
        """
        session_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=self._default_timeout)
        
        session_data = {
            "session_id": session_id,
            "user_id": user_id,
            "provider": provider,
            "state": "awaiting_device_verification",  # Start with device verification state
            "browser_context": browser_context,
            "page": None,  # Don't store page object across threads
            "provider_instance": provider_instance,  # Store provider instance for MFA handling
            "created_at": now,
            "expires_at": expires_at,
            "mfa_code": None,
            "error_message": None,
            "retry_count": 0
        }
        
        with self._lock:
            self._sessions[session_id] = session_data
        
        logger.info(
            f"Created login session {session_id} for user {user_id}, "
            f"provider {provider}, expires at {expires_at}"
        )
        
        return session_id
    
    def get_session(self, session_id: str) -> Optional[Dict]:
        """
        Retrieve a session by ID.
        
        Args:
            session_id: Session ID to retrieve
            
        Returns:
            Session data dictionary or None if not found
        """
        with self._lock:
            session = self._sessions.get(session_id)
            
            if session is None:
                logger.warning(f"Session {session_id} not found")
                return None
            
            # Check if expired
            if datetime.now(timezone.utc) > session["expires_at"]:
                logger.info(f"Session {session_id} has expired")
                session["state"] = "expired"
            
            return session.copy()  # Return a copy to avoid external mutations
    
    def update_session_state(
        self,
        session_id: str,
        state: str,
        error_message: Optional[str] = None
    ) -> bool:
        """
        Update the state of a session.
        
        Args:
            session_id: Session ID to update
            state: New state (pending_mfa, awaiting_code, completed, failed, expired)
            error_message: Optional error message
            
        Returns:
            True if session was updated, False if not found
        """
        with self._lock:
            session = self._sessions.get(session_id)
            
            if session is None:
                logger.warning(f"Cannot update state: session {session_id} not found")
                return False
            
            old_state = session["state"]
            session["state"] = state
            
            if error_message:
                session["error_message"] = error_message
            
            if state == "completed":
                session["completed_at"] = datetime.now(timezone.utc)
            
            logger.info(
                f"Session {session_id} state updated: {old_state} -> {state}"
            )
            
            return True
    
    def increment_retry_count(self, session_id: str) -> int:
        """
        Increment the retry count for a session.
        
        Args:
            session_id: Session ID
            
        Returns:
            New retry count, or -1 if session not found
        """
        with self._lock:
            session = self._sessions.get(session_id)
            
            if session is None:
                return -1
            
            session["retry_count"] += 1
            return session["retry_count"]
    
    def terminate_session(self, session_id: str) -> bool:
        """
        Terminate and remove a session, cleaning up browser resources.
        
        Args:
            session_id: Session ID to terminate
            
        Returns:
            True if session was terminated, False if not found
        """
        with self._lock:
            session = self._sessions.pop(session_id, None)
            
            if session is None:
                logger.warning(f"Cannot terminate: session {session_id} not found")
                return False
        
        # Cleanup browser resources outside the lock
        self._cleanup_browser_resources(session)
        
        logger.info(f"Terminated session {session_id}")
        return True
    
    def cleanup_expired_sessions(self) -> int:
        """
        Clean up all expired sessions.
        
        Returns:
            Number of sessions cleaned up
        """
        now = datetime.now(timezone.utc)
        expired_sessions = []
        
        with self._lock:
            for session_id, session in list(self._sessions.items()):
                if now > session["expires_at"]:
                    expired_sessions.append(self._sessions.pop(session_id))
        
        # Cleanup browser resources outside the lock
        for session in expired_sessions:
            self._cleanup_browser_resources(session)
        
        if expired_sessions:
            logger.info(f"Cleaned up {len(expired_sessions)} expired session(s)")
        
        return len(expired_sessions)
    
    def _cleanup_browser_resources(self, session: Dict) -> None:
        """
        Clean up browser context and page for a session.
        
        Args:
            session: Session data dictionary
        """
        try:
            browser_context = session.get("browser_context")
            provider_instance = session.get("provider_instance")
            
            # Close the browser context
            if browser_context:
                try:
                    browser_context.close()
                except Exception as e:
                    logger.warning(f"Error closing browser context: {e}")
            
            # Call provider cleanup if available
            if provider_instance and hasattr(provider_instance, "cleanup"):
                try:
                    provider_instance.cleanup()
                except Exception as e:
                    logger.warning(f"Error calling provider cleanup: {e}")
                    
        except Exception as e:
            logger.error(f"Error cleaning up browser resources: {e}")
    
    def get_all_sessions(self) -> Dict[str, Dict]:
        """
        Get all active sessions (for debugging/monitoring).
        
        Returns:
            Dictionary of all sessions (session_id -> session_data)
        """
        with self._lock:
            return {
                session_id: {
                    "session_id": session["session_id"],
                    "user_id": session["user_id"],
                    "provider": session["provider"],
                    "state": session["state"],
                    "created_at": session["created_at"],
                    "expires_at": session["expires_at"],
                    "retry_count": session["retry_count"]
                }
                for session_id, session in self._sessions.items()
            }
    
    def get_session_count(self) -> int:
        """
        Get the number of active sessions.
        
        Returns:
            Number of active sessions
        """
        with self._lock:
            return len(self._sessions)
    
    

