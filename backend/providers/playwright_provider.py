"""Base class for Playwright-based providers with anti-detection measures"""

import os
import concurrent.futures
from abc import ABC, abstractmethod
from typing import Optional
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

from backend.providers.base_provider import BaseProvider
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# Thread pool for running Playwright sync API outside of asyncio event loop
_playwright_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="playwright")


class PlaywrightProvider(BaseProvider, ABC):
    """Base class for providers using Playwright with comprehensive anti-detection measures"""
    
    def __init__(self, headless: bool = True, timeout: int = 30000):
        """
        Initialize Playwright provider
        
        Args:
            headless: Run browser in headless mode
            timeout: Default timeout for operations in milliseconds
        """
        self.headless = headless
        self.timeout = timeout
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self._playwright = None
    
    @abstractmethod
    def _get_session_file(self) -> str:
        """
        Get the session file path for this provider
        
        Returns:
            Path to session storage file (e.g., "session.json", "costco_session.json")
        """
        pass
    
    def _start_browser(self) -> None:
        """Start Playwright browser with comprehensive anti-detection measures"""
        if self.browser:
            return
        
        logger.info(f"Starting browser for {self.provider_name} provider")
        
        # Clear any asyncio event loop in this thread to avoid conflicts
        # This is needed when running in Flask debug mode
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Create a new event loop for this thread
                asyncio.set_event_loop(asyncio.new_event_loop())
        except RuntimeError:
            # No event loop in this thread, which is fine
            pass
        
        self._playwright = sync_playwright().start()
        
        # Use persistent context with user data directory for better anti-detection
        # This creates a real browser profile that persists cookies, history, etc.
        user_data_dir = os.path.join(os.path.dirname(__file__), "..", "..", ".browser_profiles", self.provider_name)
        os.makedirs(user_data_dir, exist_ok=True)
        
        browser_args = [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=AutomationControlled',
            '--exclude-switches=enable-automation',
            '--disable-infobars',
        ]
        
        # Use launch_persistent_context for better profile integration
        # This bypasses some bot detection by using a real browser profile
        self.context = self._playwright.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=self.headless,
            channel="chrome",  # Use real Chrome browser
            args=browser_args,
            ignore_default_args=['--enable-automation'],  # Critical: remove automation flag
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale='en-US',
            timezone_id='America/Los_Angeles',
        )
        
        # For persistent context, browser is None but context has pages
        self.browser = None  # Not used with persistent context
        
        self.context.set_default_timeout(self.timeout)
        
        # Anti-bot detection: hide webdriver flag and other automation signals
        self.context.add_init_script("""
            // Hide webdriver flag
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            
            // Hide automation-related Chrome properties
            window.chrome = { 
                runtime: {},
                loadTimes: function() { return {}; },
                csi: function() { return {}; },
                app: {}
            };
            
            // Mock plugins (real browsers have plugins)
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin' }
                ]
            });
            
            // Hide automation in permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // Remove automation-specific properties
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        """)
        
        # Get or create page from persistent context
        if self.context.pages:
            self.page = self.context.pages[0]
        else:
            self.page = self.context.new_page()
        
        # Apply playwright-stealth if available
        try:
            from playwright_stealth.stealth import Stealth
            stealth_config = Stealth()
            stealth_config.apply_stealth_sync(self.page)
            logger.info("Applied playwright-stealth to page")
        except ImportError:
            logger.warning("playwright-stealth not available, using built-in anti-detection only")
        except Exception as stealth_error:
            logger.warning(f"Could not apply playwright-stealth: {stealth_error}")
    
    def cleanup(self) -> None:
        """Cleanup browser resources"""
        # Close context first (for persistent context, this also closes the browser)
        if self.context:
            try:
                self.context.close()
            except Exception:
                pass
            self.context = None
        
        # Close browser if it exists (for non-persistent context)
        if self.browser:
            try:
                self.browser.close()
            except Exception:
                pass
            self.browser = None
        
        if self._playwright:
            try:
                self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        
        self.page = None
