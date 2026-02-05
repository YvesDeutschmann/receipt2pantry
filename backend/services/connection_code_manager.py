"""Connection code manager for user-assisted token extraction"""

import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class ConnectionCodeManager:
    """Manages temporary connection codes for user-assisted token extraction"""
    
    def __init__(self, expiry_minutes: int = 10):
        """
        Initialize connection code manager
        
        Args:
            expiry_minutes: Number of minutes before codes expire (default: 10)
        """
        self._codes: Dict[str, Dict] = {}
        self._lock = threading.Lock()
        self.expiry_minutes = expiry_minutes
        logger.info(f"ConnectionCodeManager initialized (expiry: {expiry_minutes} minutes)")
    
    def generate_code(self, user_id: str) -> str:
        """
        Generate a new connection code for a user
        
        Args:
            user_id: User ID requesting the connection
        
        Returns:
            Connection code (random string)
        """
        # Generate a secure random code (16 characters, URL-safe)
        code = secrets.token_urlsafe(12)
        
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=self.expiry_minutes)
        
        with self._lock:
            self._codes[code] = {
                "user_id": user_id,
                "status": "pending",  # pending, connected, expired
                "created_at": datetime.now(timezone.utc),
                "expires_at": expires_at,
                "connected_at": None,
            }
        
        logger.info(f"Generated connection code for user {user_id}, expires at {expires_at}")
        return code
    
    def get_code_info(self, code: str) -> Optional[Dict]:
        """
        Get information about a connection code
        
        Args:
            code: Connection code
        
        Returns:
            Dictionary with code info or None if not found/expired
        """
        with self._lock:
            if code not in self._codes:
                return None
            
            info = self._codes[code].copy()
            
            # Check if expired
            if datetime.now(timezone.utc) > info["expires_at"]:
                info["status"] = "expired"
                # Don't delete yet, let cleanup handle it
            
            return info
    
    def mark_connected(self, code: str) -> bool:
        """
        Mark a connection code as successfully connected
        
        Args:
            code: Connection code
        
        Returns:
            True if successful, False if code not found or expired
        """
        with self._lock:
            if code not in self._codes:
                return False
            
            info = self._codes[code]
            
            # Check if expired
            if datetime.now(timezone.utc) > info["expires_at"]:
                info["status"] = "expired"
                return False
            
            # Mark as connected
            info["status"] = "connected"
            info["connected_at"] = datetime.now(timezone.utc)
            
            logger.info(f"Connection code {code} marked as connected")
            return True
    
    def cleanup_expired(self) -> int:
        """
        Remove expired codes from memory
        
        Returns:
            Number of codes removed
        """
        now = datetime.now(timezone.utc)
        removed = 0
        
        with self._lock:
            expired_codes = [
                code for code, info in self._codes.items()
                if now > info["expires_at"]
            ]
            
            for code in expired_codes:
                del self._codes[code]
                removed += 1
        
        if removed > 0:
            logger.info(f"Cleaned up {removed} expired connection codes")
        
        return removed
    
    def get_status(self, code: str) -> str:
        """
        Get status of a connection code
        
        Args:
            code: Connection code
        
        Returns:
            Status string: 'pending', 'connected', 'expired', or 'not_found'
        """
        info = self.get_code_info(code)
        if not info:
            return "not_found"
        return info["status"]


# Global instance
_connection_code_manager: Optional[ConnectionCodeManager] = None


def get_connection_code_manager() -> ConnectionCodeManager:
    """Get or create the global connection code manager instance"""
    global _connection_code_manager
    if _connection_code_manager is None:
        _connection_code_manager = ConnectionCodeManager(expiry_minutes=10)
    return _connection_code_manager
