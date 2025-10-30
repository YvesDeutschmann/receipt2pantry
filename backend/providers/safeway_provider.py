"""Safeway provider implementation"""

import os
import time
from datetime import datetime
from typing import Dict, List, Optional
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext, TimeoutError as PlaywrightTimeoutError
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
        import random
        import time
        
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
        
        logger.info(f"Using random device fingerprint: {viewport}, {timezone}, {locale}")
        
        # Load existing session if available
        if os.path.exists(self.SESSION_FILE):
            self.context = self.browser.new_context(
                viewport=viewport,
                user_agent=user_agent,
                timezone_id=timezone,
                locale=locale,
                storage_state=self.SESSION_FILE
            )
            logger.info("Loaded existing session")
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
            
            logger.info("Cleared browser data for fresh session")
        except Exception as e:
            logger.warning(f"Could not clear browser data: {e}")
        
        # Force fresh session by navigating to Safeway
        try:
            self.page.goto("https://www.safeway.com/")
            logger.info("Navigated to Safeway for fresh session")
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
            logger.info(f"Applied enhanced randomized device fingerprint: {screen_width}x{screen_height}, {platform}, {hardware_cores} cores, {device_memory}GB")
        except Exception as e:
            logger.warning(f"Could not apply fingerprint randomization: {e}")
        
        logger.info("Browser started successfully")
    
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
            logger.info("Navigating to safeway.com")
            self.page.goto("https://safeway.com/", wait_until="domcontentloaded")
            
            # Check if already logged in
            if self._is_logged_in():
                logger.info("Already logged in")
                return True
            
            # Perform login
            self._perform_login(username, password, session_id)
            
            # Verify login success
            if not self._is_logged_in():
                raise AuthenticationException("Login verification failed")
            
            # Save session
            self.context.storage_state(path=self.SESSION_FILE)
            logger.info("Session saved")
            
            logger.info("Login successful")
            return True
        
        except MFARequiredException as e:
            # MFA required - don't cleanup, keep browser alive for MFA flow
            logger.info("MFA required, keeping browser session alive")
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
                logger.info(f"Not logged in (found: '{account_name}')")
                return False
            
            logger.info(f"Logged in as: {account_name}")
            return True
        except Exception:
            logger.info("Not logged in (element not found)")
            return False
    
    def _perform_login(self, username: str, password: str, session_id: Optional[str] = None) -> None:
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
            
            # Wait for page transition and check for MFA
            logger.info("Waiting for login response")
            self.page.wait_for_timeout(3000)
            
            # Debug: Log current page state
            try:
                current_url = self.page.url
                current_title = self.page.title()
                logger.info(f"Current page: {current_url}")
                logger.info(f"Page title: {current_title}")
            except Exception as e:
                logger.warning(f"Could not get page info: {e}")
            
            # Check for MFA prompt
            if self._detect_mfa_prompt():
                logger.info("MFA verification required")
                
                # Wait a bit longer for device verification modal to appear
                logger.info("Waiting for device verification modal to appear...")
                self.page.wait_for_timeout(5000)
                
                # Handle device verification immediately if needed
                if self._detect_device_verification_modal():
                    logger.info("Device verification modal detected, handling immediately")
                    try:
                        # Automatically select SMS option (first available option)
                        success = self.select_device_verification_method("sms")
                        if success:
                            logger.info("Device verification method selected successfully")
                        else:
                            logger.error("Failed to select device verification method")
                    except Exception as device_error:
                        logger.error(f"Error handling device verification: {device_error}", exc_info=True)
                else:
                    logger.info("No device verification modal detected, proceeding with MFA")
                
                raise MFARequiredException("Multi-factor authentication required to complete login")
            
            # Wait for successful login indicator
            logger.info("Login sequence completed")
        
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
                logger.info("Device verification modal detected")
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
                        logger.info(f"MFA input detected with selector: {selector}")
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
                    logger.info(f"MFA text detected: '{pattern}'")
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
            logger.info("Checking for device verification modal...")
            
            # Debug: Log page content to see what's actually there
            try:
                page_content = self.page.content()
                logger.info(f"Page content length: {len(page_content)}")
                
                # Look for specific text that indicates device verification
                if "verify-device" in page_content:
                    logger.info("Found 'verify-device' in page content")
                if "Text code to" in page_content:
                    logger.info("Found 'Text code to' in page content")
                if "Send code to" in page_content:
                    logger.info("Found 'Send code to' in page content")
                if "radioButton" in page_content:
                    logger.info("Found 'radioButton' in page content")
                    
            except Exception as e:
                logger.warning(f"Could not analyze page content: {e}")
            
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
                    logger.info(f"Selector '{selector}' found {len(elements)} elements")
                    
                    if elements:
                        logger.info(f"Device verification modal detected with selector: {selector} (found {len(elements)} elements)")
                        return True
                    
                    # Also try wait_for_selector for visible elements
                    element = self.page.wait_for_selector(selector, timeout=2000)
                    if element:
                        logger.info(f"Device verification modal detected with selector: {selector}")
                        return True
                except Exception as e:
                    logger.debug(f"Selector {selector} not found: {e}")
                    continue
            
            logger.info("No device verification modal found")
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
            logger.info(f"Selecting device verification method: {method}")
            
            # Wait for device verification modal to be visible
            self.page.wait_for_timeout(2000)

            """
            <span class="d-flex align-items-center justify-content-center pds-radio-bullet-container"><span class="pds-radio-bullet"></span></span>
            """
            
            # Select the appropriate radio button using exact selectors from HTML
            if method.lower() == "sms":
                # Select the span element by its ID
                sms_radio_option = self.page.locator("#sms")
                if sms_radio_option:
                    logger.info(f"Located SMS radio button")
                    logger.info(f"Radio Button text: {sms_radio_option.inner_text()}")
                    sms_radio_option.click()
                else:
                    logger.error("Could not find SMS radio button")
                    return False
                    
            elif method.lower() == "email":
                # Select the span element by its ID
                email_radio_option = self.page.locator("#email")
                if email_radio_option:
                    logger.info(f"Located email radio button")
                    logger.info(f"Radio Button text: {email_radio_option.inner_text()}")
                    email_radio_option.click()
                else:
                    logger.error("Could not find email radio button")
                    return False
            else:
                logger.error(f"Invalid verification method: {method}")
                return False
            
            # Wait for Continue button to become enabled and click it
            logger.info("Waiting for Continue button to become enabled...")
            try:
                continue_button = self.page.wait_for_selector(
                    "button.btn.btn-lg.btn-primary.auth-styles__btn[data-tabindex='last']:not([disabled])", 
                    timeout=10000
                )
                
                if continue_button:
                    # Wait a moment for the button to be fully ready
                    self.page.wait_for_timeout(1000)
                    
                    # Click the Continue button
                    continue_button.click()
                    logger.info("Clicked enabled Continue button")
                else:
                    logger.error("Continue button did not become enabled")
                    return False
                    
            except Exception as e:
                logger.error(f"Error waiting for Continue button: {e}")
                return False
            
            # Wait for the page to process the selection
            self.page.wait_for_timeout(3000)
            
            logger.info("Device verification method selection completed")
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
            logger.info("Getting device verification options")
            
            options = {}
            
            # Look for SMS option
            try:
                sms_element = self.page.locator("span:has-text('Text code to')").first
                if sms_element.count() > 0:
                    sms_text = sms_element.inner_text().strip()
                    options["sms"] = sms_text
                    logger.info(f"Found SMS option: {sms_text}")
            except Exception as e:
                logger.warning(f"Could not find SMS option: {e}")
            
            # Look for email option
            try:
                email_element = self.page.locator("span:has-text('Send code to')").first
                if email_element.count() > 0:
                    email_text = email_element.inner_text().strip()
                    options["email"] = email_text
                    logger.info(f"Found email option: {email_text}")
            except Exception as e:
                logger.warning(f"Could not find email option: {e}")
            
            logger.info(f"Available verification options: {options}")
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
        Handle MFA verification
        
        Args:
            mfa_code: MFA code from user
        
        Returns:
            True if verification successful
        
        Raises:
            AuthenticationException: If MFA verification fails
            ProviderException: If browser page is not active
        """
        try:
            logger.info("Starting MFA verification")
            
            # Get a fresh page object to avoid thread issues
            if not self.context:
                raise ProviderException("Browser context not available. Login session may have expired.")
            
            # Get the current page or create a new one
            try:
                pages = self.context.pages
                if pages:
                    self.page = pages[0]  # Use existing page
                else:
                    self.page = self.context.new_page()  # Create new page
                    logger.info("Created new page for MFA verification")
            except Exception as e:
                logger.error(f"Could not get page object: {e}")
                raise ProviderException("Browser page not available. Login session may have expired.")
            
            # Debug: Log current page URL and title
            try:
                current_url = self.page.url
                current_title = self.page.title()
                logger.info(f"Current page: {current_url}")
                logger.info(f"Page title: {current_title}")
            except Exception as e:
                logger.warning(f"Could not get page info: {e}")
            
            # Wait a moment for page to stabilize
            self.page.wait_for_timeout(1000)

            """
            <!-- <input type="text" aria-label="Enter Verification Code" placeholder="------" maxlength="6" size="6" min="6" max="6" formcontrolname="otpCode" aria-describedby="error-otp" required="" class="input-field__otp-code ng-untouched ng-pristine ng-invalid" data-tabindex="last"> -->
            """
            
            
            # Locate MFA input field using flexible selectors
            mfa_input = None
            mfa_selectors = [
                "input[formcontrolname='otpCode']",
                "input[aria-label='Enter Verification Code']",
            ]
            
            logger.info(f"Searching for MFA input field with {len(mfa_selectors)} selectors...")
            for selector in mfa_selectors:
                try:
                    element = self.page.locator(selector).first
                    if element.count() > 0:
                        is_visible = element.is_visible()
                        logger.info(f"Selector '{selector}': found={element.count()}, visible={is_visible}")
                        if is_visible:
                            mfa_input = element
                            logger.info(f"Found MFA input with selector: {selector}")
                            break
                except Exception as e:
                    logger.debug(f"Selector '{selector}' failed: {e}")
                    continue
            
            if not mfa_input:
                # Debug: Save screenshot and log page content snippet
                try:
                    # Ensure debug directory exists
                    os.makedirs("debug_screenshots", exist_ok=True)
                    screenshot_path = f"debug_screenshots/mfa_not_found_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
                    self.page.screenshot(path=screenshot_path)
                    logger.info(f"Screenshot saved to {screenshot_path}")
                    
                    # Log snippet of page HTML
                    page_html = self.page.content()
                    logger.info(f"Page HTML length: {len(page_html)} characters")
                    logger.info(f"Page HTML snippet: {page_html[:500]}")
                except Exception as e:
                    logger.warning(f"Could not save debug info: {e}")
                
                raise ProviderException("MFA input field not found on page")
            
            # Fill in the MFA code
            logger.info("Filling MFA code")
            mfa_input.fill(mfa_code)
            
            # Locate and click submit button
            submit_selectors = [
                "button[type='submit']",
                "btn btn-lg btn-primary auth-styles__btn",
                "button[aria-label='Sign in']",
            ]
            
            submit_button = None
            for selector in submit_selectors:
                try:
                    element = self.page.locator(selector).first
                    if element.count() > 0 and element.is_visible():
                        submit_button = element
                        logger.info(f"Found submit button with selector: {selector}")
                        break
                except Exception:
                    continue
            
            if not submit_button:
                raise ProviderException("MFA submit button not found on page")
            
            # Click submit button
            logger.info("Submitting MFA code")
            submit_button.click()
            
            # Wait for verification result
            self.page.wait_for_timeout(3000)
            
            # Check for verification success
            if self._is_logged_in():
                logger.info("MFA verification successful")
                # Save session
                self.context.storage_state(path=self.SESSION_FILE)
                logger.info("Session saved after MFA verification")
                return True
            
            # Check for error messages
            error_messages = [
                "invalid code",
                "incorrect code",
                "expired code",
                "verification failed",
                "try again"
            ]
            
            page_content = self.page.content().lower()
            for error_msg in error_messages:
                if error_msg in page_content:
                    logger.warning(f"MFA verification failed: {error_msg}")
                    raise AuthenticationException(f"MFA verification failed: {error_msg}")
            
            # If we're still on MFA page, verification likely failed
            if self._detect_mfa_prompt():
                raise AuthenticationException("MFA verification failed: Invalid code")
            
            # If we got here, something unexpected happened
            raise AuthenticationException("MFA verification result unclear")
            
        except AuthenticationException:
            # Re-raise authentication exceptions
            raise
        except Exception as e:
            logger.error(f"MFA verification error: {e}")
            raise AuthenticationException(f"MFA verification failed: {e}")
    
    

    def _handle_mfa_in_same_thread(self, session_id: str, session_manager=None) -> None:
        """
        Handle MFA in the same thread as browser automation.
        
        Args:
            session_id: Session ID to poll for MFA codes
            session_manager: Session manager instance (passed from route handler)
        """
        logger.info(f"Starting MFA handling in same thread for session {session_id}")
        
        if not session_manager:
            logger.error("Session manager not available for MFA handling")
            return
        
        # Device verification is already handled in the login method
        # Just update session state to awaiting_code
        session_manager.update_session_state(session_id, "awaiting_code")
        
        max_wait_time = 300  # 5 minutes
        poll_interval = 2  # 2 seconds
        elapsed_time = 0
        
        while elapsed_time < max_wait_time:
            try:
                # Check if session still exists
                session = session_manager.get_session(session_id)
                if not session:
                    logger.info(f"Session {session_id} no longer exists, stopping MFA handling")
                    break
                
                # Check if MFA code is available
                mfa_code = session.get("mfa_code")
                if mfa_code:
                    logger.info(f"Found MFA code for session {session_id}")
                    
                    # Process the MFA code in the same thread
                    try:
                        success = self._perform_mfa_verification(mfa_code)
                        
                        if success:
                            session_manager.update_session_state(session_id, "completed")
                            logger.info(f"MFA verification successful for session {session_id}")
                            break
                        else:
                            # MFA verification failed - increment retry count and keep waiting
                            retry_count = session_manager.increment_retry_count(session_id)
                            session_manager.update_session_state(session_id, "awaiting_code", f"Invalid MFA code (attempt {retry_count})")
                            logger.warning(f"MFA verification failed for session {session_id}, retry {retry_count}")
                        
                        # Clear the MFA code so we can wait for the next one
                        session["mfa_code"] = None
                        
                    except Exception as e:
                        logger.error(f"MFA verification error: {e}", exc_info=True)
                        session_manager.update_session_state(session_id, "failed", str(e))
                        break
                
                # Wait before next poll
                import time
                time.sleep(poll_interval)
                elapsed_time += poll_interval
                
            except Exception as e:
                logger.error(f"Error during MFA handling: {e}", exc_info=True)
                break
        
        if elapsed_time >= max_wait_time:
            logger.warning(f"MFA handling timeout for session {session_id}")
            session_manager.update_session_state(session_id, "failed", "MFA timeout")

    def _perform_mfa_verification(self, mfa_code: str) -> bool:
        """
        Perform the actual MFA verification (internal method).
        
        Args:
            mfa_code: The MFA verification code from user
            
        Returns:
            True if MFA was successful, False otherwise
        """
        try:
            logger.info("Starting MFA verification")
            
            if not self.page:
                logger.error("Browser page not available")
                return False
            
            # Debug: Log current page URL and title
            try:
                current_url = self.page.url
                current_title = self.page.title()
                logger.info(f"Current page: {current_url}")
                logger.info(f"Page title: {current_title}")
            except Exception as e:
                logger.warning(f"Could not get page info: {e}")
            
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
                        logger.info(f"Found MFA input with selector: {selector}")
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
            logger.info(f"Entered MFA code: {mfa_code}")
            
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
                        logger.info(f"Clicked submit button with selector: {selector}")
                        submitted = True
                        break
                except Exception:
                    continue
            
            if not submitted:
                # Try pressing Enter on the input field
                mfa_input.press("Enter")
                logger.info("Pressed Enter on MFA input field")
            
            # Wait for response
            logger.info("Waiting for MFA verification response")
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
                        logger.info(f"MFA verification successful - found: {indicator}")
                        return True
                except Exception:
                    continue
            
            # Check for error indicators first - but be more specific to avoid false positives
            current_url = self.page.url
            logger.info(f"MFA check - Current URL: {current_url}")
            
            # If we've been redirected away from the login page, assume success
            if "safeway.com" in current_url and "login" not in current_url.lower():
                logger.info("MFA verification appears successful - redirected to main site")
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
                        error_text = element.inner_text()
                        logger.warning(f"MFA verification failed - found error: {error_text}")
                        return False
                except Exception:
                    continue
            
            # If we're still here and on a login page, it might have failed
            # But check for success indicators first before declaring failure
            logger.warning("Could not determine MFA verification result")
            return False
            
        except Exception as e:
            logger.error(f"MFA verification error: {e}", exc_info=True)
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

