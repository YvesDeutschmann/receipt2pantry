"""Safeway provider implementation"""

import os
import random
import time
from datetime import datetime
from typing import Dict, List, Optional
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
                '--disable-blink-features=AutomationControlled',
                '--incognito',  # Start in incognito mode for fresh session
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--disable-ipc-flooding-protection',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-client-side-phishing-detection',
                '--disable-sync',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-translate',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-logging',
                '--disable-gpu-logging',
                '--silent',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-client-side-phishing-detection',
                '--disable-default-apps',
                '--disable-hang-monitor',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-web-resources',
                '--metrics-recording-only',
                '--no-report-upload',
                '--safebrowsing-disable-auto-update',
                '--enable-automation',
                '--password-store=basic',
                '--use-mock-keychain'
            ]
        )
        
        # Generate random device fingerprint for each session
        # Random viewport sizes (common resolutions)
        viewports = [
            {'width': 1366, 'height': 768},
            {'width': 1920, 'height': 1080},
            {'width': 1440, 'height': 900},
            {'width': 1536, 'height': 864},
            {'width': 1280, 'height': 720},
            {'width': 1600, 'height': 900}
        ]
        
        # Random user agents (different browsers/versions)
        user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        ]
        
        # Random timezones
        timezones = [
            'America/New_York',
            'America/Chicago', 
            'America/Denver',
            'America/Los_Angeles',
            'America/Phoenix',
            'Europe/London',
            'Europe/Paris',
            'Asia/Tokyo'
        ]
        
        # Random locales
        locales = [
            'en-US',
            'en-GB',
            'en-CA',
            'en-AU',
            'fr-FR',
            'de-DE',
            'es-ES'
        ]
        
        # Select random values
        viewport = random.choice(viewports)
        user_agent = random.choice(user_agents)
        timezone = random.choice(timezones)
        locale = random.choice(locales)
        
        # Load existing session if available
        if os.path.exists(self.SESSION_FILE):
            self.context = self.browser.new_context(
                viewport=viewport,
                user_agent=user_agent,
                timezone_id=timezone,
                locale=locale,
                storage_state=self.SESSION_FILE
            )
        else:
            self.context = self.browser.new_context(
                viewport=viewport,
                user_agent=user_agent,
                timezone_id=timezone,
                locale=locale
            )
        
        self.context.set_default_timeout(self.timeout)
        self.page = self.context.new_page()
        
        # Clear browser data for fresh testing
        try:
            # Clear cookies and storage
            self.page.context.clear_cookies()
            
            # Navigate to a blank page first to ensure we can clear storage
            self.page.goto("about:blank")
            
            # Clear all storage types
            self.page.evaluate("""
                () => {
                    try {
                        localStorage.clear();
                        sessionStorage.clear();
                        indexedDB.databases().then(dbs => {
                            dbs.forEach(db => {
                                indexedDB.deleteDatabase(db.name);
                            });
                        });
                    } catch (e) {
                        console.log('Could not clear some storage:', e);
                    }
                }
            """)
        except Exception as e:
            logger.warning(f"Could not clear browser data: {e}")
        
        # Force fresh session by navigating to Safeway
        try:
            self.page.goto("https://www.safeway.com/")
        except Exception as e:
            logger.warning(f"Could not navigate to Safeway: {e}")
        
        # Inject random fingerprint to simulate different device
        try:
            # Generate additional random values for enhanced fingerprinting
            screen_width = random.randint(1024, 2560)
            screen_height = random.randint(768, 1440)
            hardware_cores = random.randint(2, 16)
            device_memory = random.choice([2, 4, 8, 16])
            connection_type = random.choice(['4g', '3g', 'slow-2g'])
            downlink_speed = round(random.uniform(0.5, 10.0), 1)
            rtt_latency = random.randint(50, 200)
            plugin_count = random.randint(0, 5)
            platform = random.choice(['Win32', 'MacIntel', 'Linux x86_64'])
            
            # Randomize additional browser properties
            fingerprint_script = f"""
            () => {{
                // Randomize screen properties
                Object.defineProperty(screen, 'width', {{ value: {screen_width} }});
                Object.defineProperty(screen, 'height', {{ value: {screen_height} }});
                Object.defineProperty(screen, 'availWidth', {{ value: {screen_width} }});
                Object.defineProperty(screen, 'availHeight', {{ value: {screen_height - 40} }});
                Object.defineProperty(screen, 'colorDepth', {{ value: {random.choice([24, 32])} }});
                Object.defineProperty(screen, 'pixelDepth', {{ value: {random.choice([24, 32])} }});
                
                // Randomize timezone
                Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {{
                    value: function() {{ return {{ timeZone: '{timezone}' }}; }}
                }});
                
                // Randomize language
                Object.defineProperty(navigator, 'language', {{ value: '{locale}' }});
                Object.defineProperty(navigator, 'languages', {{ value: ['{locale}', 'en'] }});
                
                // Randomize platform
                Object.defineProperty(navigator, 'platform', {{ value: '{platform}' }});
                
                // Randomize hardware concurrency
                Object.defineProperty(navigator, 'hardwareConcurrency', {{ value: {hardware_cores} }});
                
                // Randomize memory
                Object.defineProperty(navigator, 'deviceMemory', {{ value: {device_memory} }});
                
                // Randomize connection
                Object.defineProperty(navigator, 'connection', {{
                    value: {{
                        effectiveType: '{connection_type}',
                        downlink: {downlink_speed},
                        rtt: {rtt_latency}
                    }}
                }});
                
                // Randomize plugins
                Object.defineProperty(navigator, 'plugins', {{
                    value: {{
                        length: {plugin_count},
                        item: function() {{ return null; }},
                        namedItem: function() {{ return null; }}
                    }}
                }});
                
                // Randomize webgl vendor/renderer
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {{
                    if (parameter === 37445) return 'Intel Inc.';
                    if (parameter === 37446) return 'Intel(R) Iris(TM) Graphics 6100';
                    return getParameter.call(this, parameter);
                }};
                
                console.log('Enhanced randomized device fingerprint applied');
            }}
            """
            self.page.evaluate(fingerprint_script)
        except Exception as e:
            logger.warning(f"Could not apply fingerprint randomization: {e}")
    
    def login(self, credentials: Dict, session_id: Optional[str] = None) -> bool:
        """
        Login to Safeway account
        
        Args:
            credentials: Dictionary with 'username' and 'password'
            session_id: Optional session ID for resuming an existing login session
        
        Returns:
            True if login successful
        
        Raises:
            AuthenticationException: If login fails
            MFARequiredException: If MFA is required (includes session_id for resumption)
        """
        try:
            logger.info("Starting Safeway login process")
            
            username = credentials.get("username")
            password = credentials.get("password")
            
            if not username or not password:
                raise AuthenticationException("Missing username or password")
            
            self._start_browser()
            
            # Navigate to Safeway
            self.page.goto("https://safeway.com/", wait_until="domcontentloaded")
            
            # Check if already logged in
            if self._is_logged_in():
                return True
            
            # Perform login
            self._perform_login(username, password, session_id)
            
            # Verify login success
            if not self._is_logged_in():
                raise AuthenticationException("Login verification failed")
            
            # Save session
            self.context.storage_state(path=self.SESSION_FILE)
            logger.info("Login successful")
            return True
        
        except MFARequiredException:
            # MFA required - don't cleanup, keep browser alive for MFA flow
            raise
        
        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise AuthenticationException(f"Login failed: {e}")
    
    def _is_logged_in(self) -> bool:
        """Check if user is already logged in"""
        try:
            account_selector = "a#auth_signin_link span[data-qa='hdr-accnt-nm']"
            self.page.wait_for_selector(account_selector, timeout=5000)
            account_name = self.page.inner_text(account_selector).strip()
            
            # If the text is "Sign in" or similar, we're NOT logged in
            if account_name.lower() in ["sign in", "signin", "log in", "login"]:
                return False
            return True
        except Exception:
            return False
    
    def _perform_login(self, username: str, password: str, session_id: Optional[str] = None) -> None:
        """Perform the login sequence"""
        try:
            # Click sign in
            sign_in_element = self.page.wait_for_selector("a#auth_signin_link")
            sign_in_element.click()
            
            # Click sign in in popup
            sign_in_btn = self.page.wait_for_selector(
                "button.btn.btn-md.btn-primary.auth-styles__btn.mb-20"
            )
            sign_in_btn.click()
            
            # Enter username
            username_input = self.page.wait_for_selector("input#enterUsername")
            username_input.fill(username)
            
            # Click sign in with password
            sign_in_pw_btn = self.page.wait_for_selector(
                "button.btn.btn-lg.btn-secondary.auth-styles__btn"
            )
            sign_in_pw_btn.click()
            
            # Enter password
            password_input = self.page.wait_for_selector("input#password")
            password_input.fill(password)
            
            # Submit
            sign_in_final = self.page.wait_for_selector(
                "button.btn.btn-lg.btn-primary.auth-styles__btn[aria-label='Sign in']"
            )
            sign_in_final.click()
            
            # Wait for page transition and check for MFA
            self.page.wait_for_timeout(3000)
            
            # Check for MFA prompt
            if self._detect_mfa_prompt():
                logger.info("MFA verification required")
                
                # Wait a bit longer for device verification modal to appear
                self.page.wait_for_timeout(5000)
                
                # Handle device verification immediately if needed
                if self._detect_device_verification_modal():
                    try:
                        # Automatically select SMS option (first available option)
                        success = self.select_device_verification_method("sms")
                        if not success:
                            logger.error("Failed to select device verification method")
                    except Exception as device_error:
                        logger.error(f"Error handling device verification: {device_error}", exc_info=True)
                
                raise MFARequiredException("Multi-factor authentication required to complete login")
        
        except MFARequiredException:
            # Re-raise MFA exceptions
            raise
        except Exception as e:
            logger.error(f"Login sequence failed: {e}")
            raise
    
    def _detect_mfa_prompt(self) -> bool:
        """
        Detect if MFA verification is required
        
        Returns:
            True if MFA prompt is detected, False otherwise
        """
        try:
            # First check for device verification modal
            if self._detect_device_verification_modal():
                return True
            
            # Check for MFA input field - Safeway uses various selectors
            mfa_selectors = [
                "input[formcontrolname='otpCode']",
                "input[placeholder*='code' i]",
                "input[placeholder*='verification' i]",
                "input[aria-label*='verification' i]",
                "input[aria-label*='code' i]",
                "input#code",
                "input[name*='code' i]",
                "input[name*='otp' i]"
            ]
            
            for selector in mfa_selectors:
                try:
                    element = self.page.locator(selector).first
                    if element.count() > 0 and element.is_visible():
                        return True
                except Exception:
                    continue
            
            # Check for MFA-related text
            mfa_text_patterns = [
                "verification code",
                "authentication code",
                "enter code",
                "6-digit code",
                "signing in from a new device"
            ]
            
            page_content = self.page.content().lower()
            for pattern in mfa_text_patterns:
                if pattern in page_content:
                    return True
            
            return False
            
        except Exception as e:
            logger.warning(f"Error detecting MFA prompt: {e}")
            return False
    
    def _detect_device_verification_modal(self) -> bool:
        """
        Detect if the device verification modal is present.
        
        Returns:
            True if device verification modal is detected
        """
        try:
            # Look for the device verification radio buttons using the exact selectors from the HTML
            device_verification_selectors = [
                "input[name='verify-device']",
                ".verify-device__radio-input",
                "label.pds-radio input[type='radio']",
                ".radioButton input[type='radio']",
                "input[aria-labelledby='sms']",
                "input[aria-labelledby='email']",
                ".web-otp .verify-device input[type='radio']",
                "new-device-login input[type='radio']"
            ]
            
            for selector in device_verification_selectors:
                try:
                    # First check if element exists (even if not visible)
                    elements = self.page.query_selector_all(selector)
                    if elements:
                        return True
                    
                    # Also try wait_for_selector for visible elements
                    element = self.page.wait_for_selector(selector, timeout=2000)
                    if element:
                        return True
                except Exception:
                    continue
            
            return False
            
        except Exception as e:
            logger.warning(f"Error detecting device verification modal: {e}")
            return False
    
    def select_device_verification_method(self, method: str) -> bool:
        """
        Select device verification method (SMS or email).
        
        Args:
            method: Either "sms" or "email"
            
        Returns:
            True if selection was successful
        """
        try:
            # Wait for device verification modal to be visible
            self.page.wait_for_timeout(2000)
            
            # Select the appropriate radio button using exact selectors from HTML
            if method.lower() == "sms":
                sms_radio_option = self.page.locator("#sms")
                if not sms_radio_option:
                    return False
                sms_radio_option.click()
            elif method.lower() == "email":
                email_radio_option = self.page.locator("#email")
                if not email_radio_option:
                    return False
                email_radio_option.click()
            else:
                return False
            
            # Wait for Continue button to become enabled and click it
            try:
                continue_button = self.page.wait_for_selector(
                    "button.btn.btn-lg.btn-primary.auth-styles__btn[data-tabindex='last']:not([disabled])", 
                    timeout=10000
                )
                
                if continue_button:
                    self.page.wait_for_timeout(1000)
                    continue_button.click()
                else:
                    return False
            except Exception as e:
                logger.error(f"Error waiting for Continue button: {e}")
                return False
            
            # Wait for the page to process the selection
            self.page.wait_for_timeout(3000)
            return True
            
        except Exception as e:
            logger.error(f"Error selecting device verification method: {e}", exc_info=True)
            return False
    
    def get_device_verification_options(self) -> Dict[str, str]:
        """
        Get available device verification options from the modal.
        
        Returns:
            Dictionary with method as key and display text as value
        """
        try:
            options = {}
            
            # Look for SMS option
            try:
                sms_element = self.page.locator("span:has-text('Text code to')").first
                if sms_element.count() > 0:
                    sms_text = sms_element.inner_text().strip()
                    options["sms"] = sms_text
            except Exception:
                pass
            
            # Look for email option
            try:
                email_element = self.page.locator("span:has-text('Send code to')").first
                if email_element.count() > 0:
                    email_text = email_element.inner_text().strip()
                    options["email"] = email_text
            except Exception:
                pass
            
            return options
            
        except Exception as e:
            logger.error(f"Error getting device verification options: {e}", exc_info=True)
            return {}
    
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
        Handle MFA verification (abstract method implementation - currently unused)
        
        Args:
            mfa_code: MFA code from user
        
        Returns:
            True if verification successful
        
        Raises:
            AuthenticationException: If MFA verification fails
            ProviderException: If browser page is not active
        """
        # Legacy method - MFA is handled via _perform_mfa_verification
        return self._perform_mfa_verification(mfa_code)


    def _perform_mfa_verification(self, mfa_code: str) -> bool:
        """
        Perform the actual MFA verification (internal method).
        
        Args:
            mfa_code: The MFA verification code from user
            
        Returns:
            True if MFA was successful, False otherwise
        """
        try:
            if not self.page:
                logger.error("Browser page not available")
                return False
            
            # Wait a moment for page to stabilize
            self.page.wait_for_timeout(1000)
            
            # Locate MFA input field using flexible selectors
            mfa_input = None
            mfa_selectors = [
                "input[formcontrolname='otpCode']",
                "input[name='otpCode']",
                "input[placeholder*='code']",
                "input[placeholder*='Code']",
                "input[placeholder*='verification']",
                "input[placeholder*='Verification']",
                "input[type='text'][maxlength='6']",
                "input[type='text'][maxlength='8']",
                "input[data-testid*='otp']",
                "input[data-testid*='mfa']",
                "input[data-testid*='verification']"
            ]
            
            for selector in mfa_selectors:
                try:
                    mfa_input = self.page.wait_for_selector(selector, timeout=2000)
                    if mfa_input:
                        break
                except Exception:
                    continue
            
            if not mfa_input:
                logger.error("Could not locate MFA input field")
                return False
            
            # Clear and enter MFA code
            mfa_input.click()
            mfa_input.fill("")
            mfa_input.type(mfa_code)
            
            # Submit the form
            submit_selectors = [
                "button[type='submit']",
                "button:has-text('Verify')",
                "button:has-text('Submit')",
                "button:has-text('Continue')",
                "input[type='submit']",
                "button[data-testid*='submit']",
                "button[data-testid*='verify']"
            ]
            
            submitted = False
            for selector in submit_selectors:
                try:
                    submit_button = self.page.wait_for_selector(selector, timeout=2000)
                    if submit_button:
                        submit_button.click()
                        submitted = True
                        break
                except Exception:
                    continue
            
            if not submitted:
                # Try pressing Enter on the input field
                mfa_input.press("Enter")
            
            # Wait for response
            self.page.wait_for_timeout(3000)
            
            # Check if verification was successful
            success_indicators = [
                "text=Welcome",
                "text=Dashboard",
                "text=Account",
                "text=Profile",
                "text=Sign Out",
                "text=Logout",
                "[data-testid*='success']",
                "[class*='success']"
            ]
            
            for indicator in success_indicators:
                try:
                    element = self.page.wait_for_selector(indicator, timeout=2000)
                    if element:
                        logger.info("MFA verification successful")
                        return True
                except Exception:
                    continue
            
            # Check if we've been redirected away from the login page
            current_url = self.page.url
            if "safeway.com" in current_url and "login" not in current_url.lower():
                logger.info("MFA verification successful")
                return True
            
            # Check for specific MFA error messages (not generic page elements)
            mfa_error_indicators = [
                "text=Invalid code",
                "text=Incorrect code",
                "text=Verification code is incorrect",
                "text=Please enter a valid code"
            ]
            
            for indicator in mfa_error_indicators:
                try:
                    element = self.page.wait_for_selector(indicator, timeout=1000)
                    if element:
                        logger.warning("MFA verification failed")
                        return False
                except Exception:
                    continue
            
            # Could not determine result
            logger.warning("Could not determine MFA verification result")
            return False
            
        except Exception as e:
            logger.error(f"MFA verification error: {e}", exc_info=True)
        return False
    
    def cleanup(self) -> None:
        """Cleanup browser resources"""
        if self.browser:
            self.browser.close()
            self.browser = None
        
        if self._playwright:
            self._playwright.stop()
            self._playwright = None
        
        self.context = None
        self.page = None

