from datetime import datetime
import hashlib
import logging
import os
import time
from dotenv import load_dotenv

from rich.console import Console
from rich.logging import RichHandler
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

load_dotenv()
console = Console()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[RichHandler(rich_tracebacks=True)]
)
logger = logging.getLogger("my_safeway_login")


class MySafewayLogin:
    """Simple Safeway login automation"""

    SESSION_FILE = "session.json"
    
    def __init__(self, username: str, password: str, headless: bool = False):
        self.username = username
        self.password = password
        self.headless = headless
        self.browser: Browser = None
        self.context: BrowserContext = None
        self.page: Page = None
    
    def __enter__(self):
        """Context manager entry"""
        self.start_browser()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.close_browser()
    
    def start_browser(self):
        """Start the browser"""
        playwright = sync_playwright().start()
                
        self.browser = playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
            ]
        )

        if os.path.exists(self.SESSION_FILE):
            self.context = self.browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                storage_state=self.SESSION_FILE
            )
            logger.info("Loaded existing session from session.json")
        else:
            self.context = self.browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )

        # if os.path.exists(self.SESSION_FILE):
            # Reuse existing session
            # self.context.storage_state(path=self.SESSION_FILE)
            
        
        # Shorter timeout
        self.context.set_default_timeout(10000)  # 10 seconds
        self.page = self.context.new_page()
        
        logger.info("Browser started successfully")

    def close_browser(self):
        """Close the browser"""
        if self.browser:
            self.browser.close()
            logger.info("Browser closed")

    def capture_screenshot(self, path: str):
        self.page.screenshot(path=path)
        with open(path.replace(".png", ".html"), "w", encoding="utf-8") as f:
            f.write(self.page.content())

    def step1_navigate_to_safeway(self) -> bool:
        """Step 1: Navigate to safeway.com"""
        try:
            logger.info("Step 1: Navigating to safeway.com...")
            
            # Use domcontentloaded instead of networkidle
            self.page.goto("https://safeway.com/", wait_until="domcontentloaded")
            
            # Check if page loaded
            title = self.page.title()
            logger.info(f"Page title: {title}")
            
            logger.info("✅ Successfully navigated to safeway.com")
            self.capture_screenshot("step1_success.png")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to navigate to safeway.com: {e}")
            return False

    def is_logged_in(self) -> bool:
        """Check if user is already logged in"""
        try:
            self.page.goto("https://www.safeway.com/", wait_until="domcontentloaded")
            
            # Look for the account menu / greeting
            account_selector = "a#auth_signin_link span[data-qa='hdr-accnt-nm']"
            self.page.wait_for_selector(account_selector, timeout=5000)
            
            account_name = self.page.inner_text(account_selector).strip()
            logger.info(f"Already logged in as: {account_name}")
            return True
        except Exception as e:
            self.capture_screenshot("login_check.png")
            logger.info("Not logged in, proceeding with login flow")
            return False


    def step2_click_sign_in_in_header(self) -> bool:
        """Step 2: Click 'Sign in' button"""
        try:
            logger.info("Step 2: Looking for 'Sign in' button...")
                        
            # Look for sign in button
            sign_in_element = self.page.wait_for_selector("a#auth_signin_link")
            
            if not sign_in_element:
                logger.error("❌ Could not find 'Sign in' button")
                return False
            
            logger.info("Found 'Sign in' button, clicking...")
            sign_in_element.click()
                        
            logger.info("✅ Successfully clicked 'Sign in' button")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to click 'Sign in' button: {e}")
            return False

    def click_sign_in_in_popup_frame(self) -> bool:
        """Step 3: Handle the login flow that appears"""
        try:
            logger.info("Step 3: Handling login flow...")
            
            sign_in_btn = self.page.wait_for_selector("button.btn.btn-md.btn-primary.auth-styles__btn.mb-20")
            sign_in_btn.click()

            logger.info("Clicked sign in button")
            
            return True

        except Exception as e:
            self.capture_screenshot("step3_error.png")
            logger.error(f"❌ Failed to handle login flow: {e}")
            return False

    def enter_email_in_modal_frame(self) -> bool:
        """Step 4: Enter email in modal frame"""
        try:
            logger.info("Step 4: Entering email in modal frame...")
            
            # Wait for the username input field
            username_input = self.page.wait_for_selector("input#enterUsername", timeout=10000)
            username_input.fill(self.username)
            logger.info("✅ Entered username")

            return True

        except Exception as e:
            logger.error(f"❌ Failed to enter email in modal frame: {e}")
            return False

    def click_signin_with_password_in_modal_frame(self) -> bool:
        """Step 5: Click signin with password in modal frame"""
        try:
            logger.info("Step 5: Clicking signin with password in modal frame...")
            
            # Click on the "Sign in with password" button
            sign_in_pw_btn = self.page.wait_for_selector(
                "button.btn.btn-lg.btn-secondary.auth-styles__btn", timeout=10000
            )
            sign_in_pw_btn.click()
            logger.info("✅ Clicked 'Sign in with password'")

            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to click signin with password in modal frame: {e}")
            return False

    def step4_enter_password(self) -> bool:
        """Step 4: Enter password and submit"""
        try:
            logger.info("Step 4: Entering password in modal...")

            # Wait for password input to appear
            password_input = self.page.wait_for_selector("input#password", timeout=10000)
            password_input.fill(self.password)
            logger.info("✅ Entered password")

            # Click the final "Sign In" button
            sign_in_btn = self.page.wait_for_selector(
                "button.btn.btn-lg.btn-primary.auth-styles__btn[aria-label='Sign in']", 
                timeout=10000
            )
            sign_in_btn.click()
            logger.info("✅ Clicked 'Sign In'")

            time.sleep(5)

            return True
        except Exception as e:
            logger.error(f"❌ Failed to enter password and sign in: {e}")
            return False

    def open_menu_after_login(self) -> bool:
        """Step 6: Open menu after login"""
        try:
            logger.info("Step 6: Opening menu after login...")
            
            account_menu = self.page.wait_for_selector("a#auth_signin_link span[data-qa='hdr-accnt-nm']", timeout=15000)
            account_menu.click()

            time.sleep(5)

            return True
        except Exception as e:
            self.page.screenshot(path="step6_error.png")
            with open("step6_error.html", "w", encoding="utf-8") as f:
                f.write(self.page.content())
            logger.error(f"❌ Failed to open menu after login: {e}")
            return False

    def select_purchases_from_menu(self) -> bool:
        """Step 7: Select purchases from menu"""
        try:
            logger.info("Step 7: Selecting purchases from menu...")
            purchases_menu_item = self.page.wait_for_selector("a[href='/order-account/orders']")
            purchases_menu_item.click()

            time.sleep(5)
       
            return True
        except Exception as e:
            logger.error(f"❌ Failed to select purchases from menu: {e}")
            return False

    def loop_through_orders(self) -> bool:
        """Step 8: Loop through orders"""
        try:
            logger.info("Step 8: Looping through orders...")

            CUTOFF = datetime(2025, 9, 10)  # example cutoff
            processed_orders = set()

            # Wait for at least one order container
            self.page.wait_for_selector("div.order-info-view-container")
            
           # Grab all orders
            orders = self.page.locator("div.order-info-view-container")
            count = orders.count()
            logger.info(f"Orders found: {count}")
            
            # Step 1: Collect metadata for all orders
            order_infos = []

            for i in range(count):
                order = orders.nth(i)
                logger.info(f"Scanning order {i}")

                # Extract date
                date_text = order.locator(".order-status-past").inner_text().strip()
                order_date_str = date_text.split("on")[-1].strip()
                order_date = datetime.strptime(order_date_str, "%b %d, %Y")
                logger.info(f"Extracted date: {order_date}")

                if not order_date > CUTOFF:
                    logger.info(f"Order date is before cutoff, skipping...")
                    continue

                # Extract summary (items + total)
                summary_text = order.locator(".info-view-sub-header").inner_text().strip()
                num_items, total_price = [x.strip() for x in summary_text.split("·")]
                logger.info(f"Extracted summary: {num_items} items, {total_price} total")

                # Build key
                key_string = f"{order_date_str}|{num_items}|{total_price}"
                order_key = self.generate_order_key(key_string)
                logger.info(f"Generated order key: {order_key} for order {key_string}")
                # Store metadata (and also a locator to click later if needed)
                order_infos.append({
                    "index": i,
                    "date": order_date,
                    "num_items": num_items,
                    "total_price": total_price,
                    "key": order_key
                })

            logger.info(f"Collected {len(order_infos)} orders to process")

            # Step 2: Process each order independently
            for info in order_infos:
                logger.info(f"Processing {info['key']} from {info['date']}")

                # You may need to re-locate the order element each time
                order = orders.nth(info["index"])
                order.locator("div[aria-label='View details']").click()

                # if order_key in processed_orders:
                #     logger.info(f"Order {key_string} already processed, skipping...")
                #     continue  # skip already processed

                # Click by the paragraph text inside the button
                self.page.locator('button:has(p:has-text("Receipt"))').click()

                # Click by data-testid (most reliable)
                self.page.get_by_test_id("instore-email-btn").click()

                # Fill by name attribute
                self.page.get_by_role('textbox', name='email').fill(self.username)

                # Click by button text
                self.page.get_by_role('button', name='Send').click()

                # Click by button text
                # Click by class and text
                self.page.locator('div.backbuttonstyles:has-text("Back")').click()

                # Click by button text
                # Click by class and text
                self.page.locator('div.backbuttonstyles:has-text("Back")').click()
                
                # Click by button text
                # Click by class and text
                self.page.locator('div.backbuttonstyles:has-text("Purchases")').click()

                self.page.wait_for_selector(".order-status-past")

                processed_orders.add(order_key)
                logger.info(f"Added order {order_key} to processed orders")

                time.sleep(2)
                    
            return True
        except Exception as e:
            logger.error(f"❌ Failed to loop through orders: {e}")
            return False

    def generate_order_key(self, key_string: str) -> str:
        # MD5 hash
        return hashlib.md5(key_string.encode()).hexdigest()        
    
    def safe_session_context(self) -> bool:
        """Step 6: Save session context"""
        # Save context storage (cookies, localStorage, sessionStorage) to file
        self.context.storage_state(path="session.json")
        logger.info("Session saved to session.json")
        return True

    def complete_login_process(self) -> bool:
        # Step 2: Click 'Sign in'
        if not self.step2_click_sign_in_in_header():
            return False            

        # Step 3: Handle login flow
        if not self.click_sign_in_in_popup_frame():
            return False

        if not self.enter_email_in_modal_frame():
            return False

        if not self.click_signin_with_password_in_modal_frame():
            return False
        
        if not self.step4_enter_password():
            return False
        return True

    def run_login_process(self) -> bool:
        """Run the complete login process"""
        # Define ordered steps as a list of (method, description) tuples
        steps = [
            (self.step1_navigate_to_safeway, "Navigate to safeway.com"),
            (self.check_and_complete_login, "Check and complete login if needed"),
            (self.open_menu_after_login, "Open menu after login"),
            (self.select_purchases_from_menu, "Select purchases from menu"),
            (self.loop_through_orders, "Loop through orders"),
            (self.safe_session_context, "Save session context")
        ]
        
        try:
            logger.info("🚀 Starting simple Safeway login process...")
            
            # Execute each step in order
            for step_method, description in steps:
                logger.info(f"📋 Executing: {description}")
                if not step_method():
                    logger.error(f"❌ Failed at step: {description}")
                    return False
                logger.info(f"✅ Completed: {description}")
            
            logger.info("🎉 Login process completed successfully!")
            return True
            
        except Exception as e:
            logger.error(f"❌ Login process failed with exception: {e}")
            return False
    
    def check_and_complete_login(self) -> bool:
        """Check if logged in and complete login if needed"""
        if not self.is_logged_in():
            return self.complete_login_process()
        return True

def main():
    """Main function"""
    # Get credentials from user
    username = os.getenv("SAFEWAY_USERNAME")
    password = os.getenv("SAFEWAY_PASSWORD")

    # Ask about headless mode
    headless_input = input("Run in headless mode? (y/n, default: n): ").strip().lower()
    headless = headless_input == 'y'
    
    console.print(f"\n[blue]Starting simple login process...[/blue]")
    console.print(f"[blue]Username: {username}[/blue]")
    console.print(f"[blue]Headless: {headless}[/blue]")
    
    with MySafewayLogin(username, password, headless) as login_automation:
        success = login_automation.run_login_process()
        
        if success:
            console.print("\n[green]🎉 Login successful![/green]")
        else:
            console.print("\n[red]❌ Login failed![/red]")
            console.print("[yellow]Check the screenshots for debugging[/yellow]")


if __name__ == "__main__":
    main()