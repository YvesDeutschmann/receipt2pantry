"""Safeway provider implementation"""

import os
import time
from datetime import datetime
from typing import Dict, List
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext
from backend.providers.base_provider import BaseProvider
from backend.providers.provider_registry import register_provider
from backend.utils.exceptions import AuthenticationException, ProviderException, MFARequiredException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


@register_provider("safeway")
class SafewayProvider(BaseProvider):
    """Safeway grocery provider automation"""
    
    SESSION_FILE = "session.json"
    
    def __init__(self, headless: bool = True, timeout: int = 30000):
        """
        Initialize Safeway provider
        
        Args:
            headless: Run browser in headless mode
            timeout: Default timeout for operations in milliseconds
        """
        self.headless = headless
        self.timeout = timeout
        self.browser: Browser = None
        self.context: BrowserContext = None
        self.page: Page = None
        self._playwright = None
    
    @property
    def provider_name(self) -> str:
        return "safeway"
    
    def _start_browser(self) -> None:
        """Start Playwright browser"""
        if self.browser:
            return
        
        logger.info("Starting browser for Safeway provider")
        self._playwright = sync_playwright().start()
        
        self.browser = self._playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        )
        
        # Load existing session if available
        if os.path.exists(self.SESSION_FILE):
            self.context = self.browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                storage_state=self.SESSION_FILE
            )
            logger.info("Loaded existing session")
        else:
            self.context = self.browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            )
        
        self.context.set_default_timeout(self.timeout)
        self.page = self.context.new_page()
        logger.info("Browser started successfully")
    
    def login(self, credentials: Dict) -> bool:
        """
        Login to Safeway account
        
        Args:
            credentials: Dictionary with 'username' and 'password'
        
        Returns:
            True if login successful
        
        Raises:
            AuthenticationException: If login fails
        """
        try:
            logger.info("Starting Safeway login process")
            
            username = credentials.get("username")
            password = credentials.get("password")
            
            if not username or not password:
                raise AuthenticationException("Missing username or password")
            
            self._start_browser()
            
            # Navigate to Safeway
            logger.info("Navigating to safeway.com")
            self.page.goto("https://safeway.com/", wait_until="domcontentloaded")
            
            # Check if already logged in
            if self._is_logged_in():
                logger.info("Already logged in")
                return True
            
            # Perform login
            self._perform_login(username, password)
            
            # Verify login success
            if not self._is_logged_in():
                raise AuthenticationException("Login verification failed")
            
            # Save session
            self.context.storage_state(path=self.SESSION_FILE)
            logger.info("Session saved")
            
            logger.info("Login successful")
            return True
        
        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise AuthenticationException(f"Login failed: {e}")
    
    def _is_logged_in(self) -> bool:
        """Check if user is already logged in"""
        try:
            account_selector = "a#auth_signin_link span[data-qa='hdr-accnt-nm']"
            self.page.wait_for_selector(account_selector, timeout=5000)
            account_name = self.page.inner_text(account_selector).strip()
            logger.info(f"Logged in as: {account_name}")
            return True
        except Exception:
            logger.info("Not logged in")
            return False
    
    def _perform_login(self, username: str, password: str) -> None:
        """Perform the login sequence"""
        try:
            # Click sign in
            logger.info("Clicking sign in button")
            sign_in_element = self.page.wait_for_selector("a#auth_signin_link")
            sign_in_element.click()
            
            # Click sign in in popup
            sign_in_btn = self.page.wait_for_selector(
                "button.btn.btn-md.btn-primary.auth-styles__btn.mb-20"
            )
            sign_in_btn.click()
            
            # Enter username
            logger.info("Entering username")
            username_input = self.page.wait_for_selector("input#enterUsername")
            username_input.fill(username)
            
            # Click sign in with password
            sign_in_pw_btn = self.page.wait_for_selector(
                "button.btn.btn-lg.btn-secondary.auth-styles__btn"
            )
            sign_in_pw_btn.click()
            
            # Enter password
            logger.info("Entering password")
            password_input = self.page.wait_for_selector("input#password")
            password_input.fill(password)
            
            # Submit
            sign_in_final = self.page.wait_for_selector(
                "button.btn.btn-lg.btn-primary.auth-styles__btn[aria-label='Sign in']"
            )
            sign_in_final.click()
            
            # Wait for login to complete
            time.sleep(5)
            logger.info("Login sequence completed")
        
        except Exception as e:
            logger.error(f"Login sequence failed: {e}")
            raise
    
    def fetch_receipts(self, since: datetime) -> List[Dict]:
        """
        Fetch receipts from Safeway account
        
        Args:
            since: Fetch receipts from this date onwards
        
        Returns:
            List of receipt dictionaries (Note: actual receipt fetching not implemented
            in original code - returns empty list for now)
        
        Raises:
            ProviderException: If fetching fails
        """
        try:
            logger.info(f"Fetching receipts since {since}")
            
            if not self.page:
                raise ProviderException("Browser not started. Call login() first.")
            
            # Navigate to orders page
            logger.info("Navigating to orders page")
            
            # Open account menu
            account_menu = self.page.wait_for_selector(
                "a#auth_signin_link span[data-qa='hdr-accnt-nm']", timeout=15000
            )
            account_menu.click()
            time.sleep(2)
            
            # Click purchases
            purchases_menu = self.page.wait_for_selector("a[href='/order-account/orders']")
            purchases_menu.click()
            time.sleep(5)
            
            # Get orders
            receipts = self._extract_orders(since)
            
            logger.info(f"Fetched {len(receipts)} receipts")
            return receipts
        
        except Exception as e:
            logger.error(f"Failed to fetch receipts: {e}")
            raise ProviderException(f"Failed to fetch receipts: {e}")
    
    def _extract_orders(self, since: datetime) -> List[Dict]:
        """Extract orders from the orders page"""
        receipts = []
        
        try:
            # Wait for orders to load
            self.page.wait_for_selector("div.order-info-view-container")
            
            orders = self.page.locator("div.order-info-view-container")
            count = orders.count()
            logger.info(f"Found {count} orders")
            
            for i in range(count):
                try:
                    order = orders.nth(i)
                    
                    # Extract date
                    date_text = order.locator(".order-status-past").inner_text().strip()
                    order_date_str = date_text.split("on")[-1].strip()
                    order_date = datetime.strptime(order_date_str, "%b %d, %Y")
                    
                    # Skip if before cutoff date
                    if order_date < since:
                        logger.info(f"Order from {order_date} is before cutoff, skipping")
                        continue
                    
                    # Extract summary
                    summary_text = order.locator(".info-view-sub-header").inner_text().strip()
                    num_items, total_price = [x.strip() for x in summary_text.split("·")]
                    
                    # Note: Original code sends receipt via email but doesn't capture it
                    # This would need to be integrated with email fetching
                    receipts.append({
                        "order_date": order_date.strftime("%Y-%m-%d"),
                        "num_items": num_items,
                        "total_price": total_price,
                        "raw_data": "",  # Would be populated from email
                    })
                    
                except Exception as e:
                    logger.warning(f"Failed to extract order {i}: {e}")
                    continue
            
            return receipts
        
        except Exception as e:
            logger.error(f"Failed to extract orders: {e}")
            return []
    
    def handle_mfa(self, mfa_code: str) -> bool:
        """
        Handle MFA verification
        
        Args:
            mfa_code: MFA code from user
        
        Returns:
            True if verification successful
        """
        # MFA not implemented in original code
        logger.warning("MFA handling not implemented for Safeway")
        return False
    
    def cleanup(self) -> None:
        """Cleanup browser resources"""
        logger.info("Cleaning up Safeway provider resources")
        
        if self.browser:
            self.browser.close()
            self.browser = None
        
        if self._playwright:
            self._playwright.stop()
            self._playwright = None
        
        self.context = None
        self.page = None
        logger.info("Cleanup complete")

