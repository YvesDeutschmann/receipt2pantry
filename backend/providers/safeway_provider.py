"""Safeway provider implementation"""

import hashlib
import json
import os
import re
import time
import urllib.parse
import requests
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from backend.providers.playwright_provider import PlaywrightProvider
from backend.providers.provider_registry import register_provider
from backend.utils.exceptions import AuthenticationException, ProviderException, MFARequiredException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


@register_provider("safeway")
class SafewayProvider(PlaywrightProvider):
    """Safeway grocery provider automation"""
    
    def __init__(self, headless: bool = True, timeout: int = 30000):
        """
        Initialize Safeway provider
        
        Args:
            headless: Run browser in headless mode
            timeout: Default timeout for operations in milliseconds
        """
        super().__init__(headless=headless, timeout=timeout)
    
    def _get_session_file(self) -> str:
        """Get the session file path for Safeway"""
        return "session.json"
    
    @property
    def provider_name(self) -> str:
        return "safeway"
    
    def _start_browser(self) -> None:
        """Start Playwright browser with Safeway-specific initialization"""
        # Call parent to set up browser with anti-detection measures
        super()._start_browser()
        
        # Safeway-specific: Clear browser data for fresh testing
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
                        // Storage clear failed for some origin
                    }
                }
            """)
        except Exception as e:
            logger.warning(f"Could not clear browser data: {e}")
        
        # Safeway-specific: Force fresh session by navigating to Safeway
        try:
            self.page.goto("https://www.safeway.com/")
        except Exception as e:
            logger.warning(f"Could not navigate to Safeway: {e}")
    
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
            self.context.storage_state(path=self._get_session_file())
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
            # First check for device verification modal (most reliable indicator)
            if self._detect_device_verification_modal():
                logger.info("MFA detected: device verification modal found")
                return True
            
            # Check for visible MFA input field with strict selectors
            # These are Safeway-specific OTP input selectors
            mfa_input_selectors = [
                "input[formcontrolname='otpCode']",  # Safeway's actual OTP input
                "input[aria-label='Enter Verification Code']",  # Exact aria-label
            ]
            
            for selector in mfa_input_selectors:
                try:
                    element = self.page.locator(selector).first
                    if element.count() > 0 and element.is_visible():
                        logger.info(f"MFA detected: found visible input with selector {selector}")
                        return True
                except Exception:
                    continue
            
            # Check for the specific MFA modal title (more reliable than page-wide text search)
            try:
                mfa_title = self.page.locator("h2:has-text('signing in from a new device')").first
                if mfa_title.count() > 0 and mfa_title.is_visible():
                    logger.info("MFA detected: found 'signing in from a new device' modal title")
                    return True
            except Exception:
                pass
            
            # DO NOT check for generic text patterns on the whole page
            # as they can match footer/help content and cause false positives
            
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
                    # #region agent log
                    # #endregion
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
    
    def _fetch_instore_via_api(self, since: datetime) -> List[Dict]:
        """
        Fetch in-store receipts directly via Safeway API.
        This bypasses the webpage and calls the API endpoint directly using
        the session tokens from the browser.
        
        Args:
            since: Fetch receipts from this date onwards
            
        Returns:
            List of receipt dictionaries with items
        """
        receipts = []
        
        try:
            # Extract cookies from browser context
            cookies = self.context.cookies()
            cookie_dict = {c['name']: c['value'] for c in cookies}
            
            # #region agent log
            # #endregion
            
            # Extract access token from SWY_SHARED_SESSION cookie
            access_token = None
            clubcard = None
            
            if 'SWY_SHARED_SESSION' in cookie_dict:
                try:
                    session_data = urllib.parse.unquote(cookie_dict['SWY_SHARED_SESSION'])
                    session_json = json.loads(session_data)
                    access_token = session_json.get('accessToken')
                except Exception as e:
                    logger.warning(f"Failed to parse SWY_SHARED_SESSION: {e}")
            
            # Extract clubcard from ACI_S_abs_previouslogin or SWY_SHARED_SESSION_INFO
            for cookie_name in ['ACI_S_abs_previouslogin', 'SWY_SHARED_SESSION_INFO']:
                if cookie_name in cookie_dict and not clubcard:
                    try:
                        info_data = urllib.parse.unquote(cookie_dict[cookie_name])
                        info_json = json.loads(info_data)
                        clubcard = info_json.get('info', {}).get('COMMON', {}).get('clubCard')
                    except Exception as e:
                        logger.warning(f"Failed to parse {cookie_name}: {e}")
            
            # #region agent log
            # #endregion
            
            if not access_token or not clubcard:
                logger.error("Could not extract access token or clubcard from cookies")
                return []
            
            # Build request headers (mimic real Chrome browser)
            headers = {
                'accept': '*/*',
                'accept-language': 'en-US,en;q=0.9',
                'content-type': 'text/plain;charset=UTF-8',
                'origin': 'https://www.safeway.com',
                'referer': 'https://www.safeway.com/order-account/orders',
                'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            }
            
            # Build request body (matches Chrome: params.clubcard, params["client-section"], token, banner)
            payload = {
                "params": {
                    "clubcard": clubcard,
                    "client-section": "purchase"
                },
                "token": access_token,
                "banner": "safeway"
            }
            
            # #region agent log
            # #endregion
            
            # Prefer Playwright context.request so cookies are sent identically to the browser
            INSTORE_URL = 'https://www.safeway.com/order-account/api/instore'
            req_headers = {'content-type': 'text/plain;charset=UTF-8', 'accept': '*/*', 'origin': 'https://www.safeway.com', 'referer': 'https://www.safeway.com/order-account/orders'}
            if getattr(self.context, 'request', None):
                try:
                    resp = self.context.request.post(
                        INSTORE_URL,
                        data=json.dumps(payload),
                        headers=req_headers,
                        timeout=30000
                    )
                    status = resp.status
                    body_text = resp.text()
                    try:
                        data = resp.json() if status == 200 else {}
                    except Exception:
                        data = {}
                except Exception as ctx_err:
                    logger.warning(f"Context request failed, falling back to requests: {ctx_err}")
                    status = 0
                    body_text = ''
                    data = {}
            else:
                status = 0
                body_text = ''
                data = {}
            if status != 200 or not data:
                cookie_str = '; '.join([f"{c['name']}={c['value']}" for c in cookies])
                headers['Cookie'] = cookie_str
                response = requests.post(INSTORE_URL, headers=headers, json=payload, timeout=30)
                status = response.status_code
                body_text = response.text
                data = response.json() if status == 200 else {}
            
            # #region agent log
            # #endregion
            
            if status != 200:
                logger.error(f"In-store API returned status {status}: {body_text[:500]}")
                return []
            
            def _parse_receipt_list_from_data(response_data):
                """Extract receipt list from list API response (receipts, purchaseHistory, or orders)."""
                out = []
                if isinstance(response_data, dict):
                    out = response_data.get('receipts') or response_data.get('purchaseHistory') or response_data.get('orders')
                    if out is None and 'data' in response_data and isinstance(response_data.get('data'), dict):
                        out = response_data['data'].get('receipts') or response_data['data'].get('purchaseHistory') or response_data['data'].get('orders')
                if not isinstance(out, list):
                    out = []
                return out

            # Parse response (data already parsed above)
            # #region agent log
            data_keys = list(data.keys()) if isinstance(data, dict) else []
            preview = str(data)[:500].replace('"', '\\"').replace('\n', '\\n')
            # #endregion

            receipt_list = _parse_receipt_list_from_data(data)

            # If list empty, retry list request with only clubcard (no client-section)
            if not receipt_list:
                logger.info("List response had no receipts, retrying with params: { clubcard } only")
                fallback_payload = {"params": {"clubcard": clubcard}, "token": access_token, "banner": "safeway"}
                fallback_status = 0
                fallback_data = {}
                if getattr(self.context, 'request', None):
                    try:
                        fr = self.context.request.post(
                            INSTORE_URL,
                            data=json.dumps(fallback_payload),
                            headers=req_headers,
                            timeout=30000
                        )
                        fallback_status = fr.status
                        if fallback_status == 200:
                            try:
                                fallback_data = fr.json()
                            except Exception:
                                fallback_data = {}
                    except Exception as e:
                        logger.warning(f"Fallback list request failed: {e}")
                if fallback_status != 200 or not fallback_data:
                    cookie_str = '; '.join([f"{c['name']}={c['value']}" for c in cookies])
                    fallback_headers = {**headers, 'Cookie': cookie_str}
                    fallback_resp = requests.post(INSTORE_URL, headers=fallback_headers, json=fallback_payload, timeout=30)
                    fallback_status = fallback_resp.status_code
                    fallback_data = fallback_resp.json() if fallback_status == 200 else {}
                if fallback_status == 200 and fallback_data:
                    receipt_list = _parse_receipt_list_from_data(fallback_data)
                    if receipt_list:
                        logger.info(f"Fallback list returned {len(receipt_list)} receipts")

            # #region agent log
            first_keys = list(receipt_list[0].keys()) if receipt_list and isinstance(receipt_list[0], dict) else []
            # #endregion
            
            for receipt_summary in receipt_list:
                try:
                    # Extract receipt date from posDateTime
                    receipt_date = None
                    pos_datetime = receipt_summary.get('posDateTime', '')
                    if pos_datetime:
                        try:
                            # Format: "2026-01-21T17:38:03.000Z"
                            receipt_date = datetime.strptime(pos_datetime[:19], '%Y-%m-%dT%H:%M:%S')
                        except:
                            pass
                    
                    # Skip if before cutoff (compare by date only so same-day receipts are included)
                    if receipt_date and receipt_date.date() < since.date():
                        # #region agent log
                        # #endregion
                        continue
                    
                    # Get receipt details using _id or id (H2: API may use 'id' not '_id')
                    receipt_id = receipt_summary.get('_id') or receipt_summary.get('id') or ''
                    
                    if not receipt_id:
                        # Still capture high-level details; normalize for receipt_service
                        order_date_str = receipt_date.strftime('%Y-%m-%d') if receipt_date else datetime.now().strftime('%Y-%m-%d')
                        receipts.append({
                            'order_id': receipt_summary.get('transactionId') or f"unknown-{order_date_str}-{len(receipts)}",
                            'order_date': order_date_str,
                            'total_amount': float(receipt_summary.get('finalTotal', receipt_summary.get('total', 0))),
                            'num_items': int(receipt_summary.get('itemCount', receipt_summary.get('item_count', 0))),
                            'date': receipt_date.isoformat() if receipt_date else datetime.now().isoformat(),
                            'store': receipt_summary.get('storeName', receipt_summary.get('store', 'Safeway')),
                            'items': [],
                            'source': 'safeway_instore_api'
                        })
                        continue
                    
                    # #region agent log
                    # #endregion
                    
                    # Fetch full receipt details (same API, params.id for detail - matches Chrome)
                    detail_payload = {
                        "params": {"clubcard": clubcard, "id": receipt_id},
                        "token": access_token,
                        "banner": "safeway"
                    }
                    detail_status = 0
                    detail_data = {}
                    if getattr(self.context, 'request', None):
                        try:
                            dr = self.context.request.post(
                                INSTORE_URL,
                                data=json.dumps(detail_payload),
                                headers=req_headers,
                                timeout=30000
                            )
                            detail_status = dr.status
                            if detail_status == 200:
                                try:
                                    detail_data = dr.json()
                                except Exception:
                                    detail_data = {}
                        except Exception as e:
                            logger.warning(f"Context detail request failed: {e}")
                    if detail_status != 200 or not detail_data:
                        headers_with_cookie = {**headers, 'Cookie': '; '.join([f"{c['name']}={c['value']}" for c in cookies])}
                        detail_response = requests.post(INSTORE_URL, headers=headers_with_cookie, json=detail_payload, timeout=30)
                        detail_status = detail_response.status_code
                        detail_data = detail_response.json() if detail_status == 200 else {}
                    
                    if detail_status != 200:
                        logger.warning(f"Failed to get receipt details for {receipt_id}: {detail_status}")
                        order_date_str = receipt_date.strftime('%Y-%m-%d') if receipt_date else datetime.now().strftime('%Y-%m-%d')
                        receipts.append({
                            'order_id': receipt_summary.get('transactionId') or receipt_id,
                            'order_date': order_date_str,
                            'total_amount': float(receipt_summary.get('finalTotal', 0) or 0),
                            'num_items': int(receipt_summary.get('itemCount', 0) or 0),
                            'date': receipt_date.isoformat() if receipt_date else datetime.now().isoformat(),
                            'store': receipt_summary.get('storeName', 'Safeway'),
                            'items': [],
                            'source': 'safeway_instore_api'
                        })
                        continue
                    
                    # #region agent log
                    detail_preview = str(detail_data)[:800].replace('"', '\\"').replace('\n', '\\n')
                    # #endregion
                    
                    # Detail API returns {"receipts": [{ "items": [...], "finalTotal": "...", ... }]} - use as single source of truth
                    detail_receipts = detail_data.get('receipts') or []
                    detail_receipt = detail_receipts[0] if detail_receipts else {}
                    item_list = detail_receipt.get('items', detail_receipt.get('lineItems', []))
                    if not item_list:
                        item_list = detail_data.get('items', detail_data.get('lineItems', detail_data.get('products', [])))
                    if not item_list and detail_data.get('receipt'):
                        item_list = detail_data['receipt'].get('items', detail_data['receipt'].get('lineItems', []))

                    # Item fields per API: name, reducedPriceTotal (prefer for line total), regularPrice, quantity, department, discount
                    items = []
                    for item in item_list or []:
                        price_val = item.get('reducedPriceTotal') or item.get('reducedPrice') or item.get('price') or item.get('extendedPrice') or item.get('amount') or item.get('finalPrice') or 0
                        try:
                            price_float = float(price_val)
                        except (TypeError, ValueError):
                            price_float = 0.0
                        qty = item.get('quantity', item.get('qty', 1))
                        try:
                            qty_num = int(qty) if isinstance(qty, (int, float)) and qty == int(qty) else float(qty)
                        except (TypeError, ValueError):
                            qty_num = 1
                        items.append({
                            'name': item.get('name', item.get('description', item.get('productName', 'Unknown'))),
                            'price': price_float,
                            'quantity': qty_num,
                            'unit': 'count' if not item.get('weightItem') else 'lb',
                            'category': item.get('department', item.get('category', item.get('dept', 'Grocery'))),
                            'regular_price': item.get('regularPrice', item.get('basePrice')),
                            'savings': item.get('discount', item.get('savings', item.get('promo')))
                        })

                    # Build receipt from detail_receipt; normalize for receipt_service (order_id, order_date, total_amount, num_items)
                    pos_dt = detail_receipt.get('posDateTime') or ''
                    if pos_dt:
                        try:
                            detail_date = datetime.strptime(pos_dt[:19], '%Y-%m-%dT%H:%M:%S')
                        except (TypeError, ValueError):
                            detail_date = receipt_date
                    else:
                        detail_date = receipt_date
                    order_date_str = (detail_date.strftime('%Y-%m-%d') if detail_date else datetime.now().strftime('%Y-%m-%d'))
                    order_id = detail_receipt.get('transactionId') or receipt_id
                    try:
                        total_amount_float = float(detail_receipt.get('finalTotal', 0))
                    except (TypeError, ValueError):
                        total_amount_float = 0.0
                    num_items_val = detail_receipt.get('itemCount')
                    if num_items_val is None:
                        num_items_val = len(items)
                    try:
                        num_items_int = int(num_items_val)
                    except (TypeError, ValueError):
                        num_items_int = len(items)

                    receipts.append({
                        'order_id': order_id,
                        'order_date': order_date_str,
                        'total_amount': total_amount_float,
                        'num_items': num_items_int,
                        'date': detail_date.isoformat() if detail_date else (receipt_date.isoformat() if receipt_date else datetime.now().isoformat()),
                        'store': detail_receipt.get('storeName', receipt_summary.get('storeName', 'Safeway')),
                        'items': items,
                        'source': 'safeway_instore_api'
                    })
                    
                    # #region agent log
                    # #endregion
                        
                except Exception as e:
                    logger.warning(f"Failed to parse receipt from API: {e}")
                    # #region agent log
                    # #endregion
                    continue
            
            # #region agent log
            # #endregion
            
            logger.info(f"Fetched {len(receipts)} in-store receipts via API")
            return receipts
            
        except Exception as e:
            logger.error(f"Failed to fetch in-store receipts via API: {e}", exc_info=True)
            # #region agent log
            # #endregion
            return []
    
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
            
            # #region agent log
            # #endregion
            
            # Open account menu
            # #region agent log
            # #endregion
            try:
                account_menu = self.page.wait_for_selector(
                    "a#auth_signin_link span[data-qa='hdr-accnt-nm']", timeout=15000
                )
                # #region agent log
                # #endregion
                account_menu.click()
            except Exception as menu_err:
                # #region agent log
                # #endregion
                # Try alternative selectors
                alt_selectors = [
                    "button[data-qa='hdr-accnt-nm']",
                    "[data-qa='hdr-accnt-nm']",
                    ".menu-nav__profile-button",
                    "a.menu-nav__profile-link",
                    "#sign-in-profile-text",
                ]
                found = False
                for sel in alt_selectors:
                    try:
                        # #region agent log
                        # #endregion
                        account_menu = self.page.wait_for_selector(sel, timeout=5000)
                        account_menu.click()
                        found = True
                        # #region agent log
                        # #endregion
                        break
                    except:
                        continue
                if not found:
                    raise menu_err
            
            time.sleep(2)
            
            # Click purchases
            # #region agent log
            # #endregion
            try:
                purchases_menu = self.page.wait_for_selector("a[href='/order-account/orders']", timeout=10000)
                # #region agent log
                # #endregion
                purchases_menu.click()
            except Exception as purch_err:
                # #region agent log
                # #endregion
                # Try alternative selectors for purchases
                alt_purchase_selectors = [
                    "a[href*='orders']",
                    "a:has-text('Past Orders')",
                    "a:has-text('Order History')",
                    "a:has-text('Purchases')",
                ]
                found = False
                for sel in alt_purchase_selectors:
                    try:
                        purchases_menu = self.page.wait_for_selector(sel, timeout=5000)
                        purchases_menu.click()
                        found = True
                        # #region agent log
                        # #endregion
                        break
                    except:
                        continue
                if not found:
                    raise purch_err
            
            time.sleep(5)
            
            # Click on "In-store" tab to see in-store receipts
            # (Online orders have different structure, in-store is more common)
            try:
                # Wait for tabs to be visible
                self.page.wait_for_selector("ul.nav-tabs, [role='tablist']", timeout=5000)
                
                # Try to click "In-store" tab
                instore_tab_selectors = [
                    "li[role='tab']:has-text('In-store')",
                    "li:has-text('In-store')",
                    "[aria-controls='in-store-panel']",
                ]
                
                for sel in instore_tab_selectors:
                    try:
                        instore_tab = self.page.locator(sel)
                        if instore_tab.count() > 0:
                            # #region agent log
                            # #endregion
                            instore_tab.click()
                            time.sleep(2)
                            break
                    except:
                        continue
                        
            except Exception as tab_err:
                # #region agent log
                # #endregion
                logger.info("Could not find In-store tab, continuing with current view")
            
            time.sleep(3)  # Extra wait for content to load

            # H9: Specifically capture In-store panel content
            try:
                instore_panel = self.page.locator("#in-store-panel, [aria-controls='in-store-panel'] ~ div, div.tab-pane.active, div.tab-pane.show")
                if instore_panel.count() > 0:
                    instore_html = instore_panel.first.evaluate("el => el.outerHTML.substring(0, 1500)")
                else:
                    pass
            except Exception as panel_err:
                pass
            
            # H9: Check for error messages
            try:
                error_selectors = [".error", ".alert", "[class*='error']", "[class*='Error']", "p:has-text('error')", "div:has-text('no orders')", "div:has-text('No orders')"]
                for esel in error_selectors:
                    err_el = self.page.locator(esel)
                    if err_el.count() > 0:
                        err_text = err_el.first.inner_text()[:300]
                        break
            except:
                pass
            
            # H10: Probe for in-store specific containers
            instore_probe_selectors = [
                "#in-store-panel .order-info-view-container",
                "#in-store-panel div[class*='order']",
                ".instore-receipt", "[data-testid*='instore']",
                "div.tab-pane.active .order-info-view-container",
                ".tab-content .show .order-info-view-container"
            ]
            instore_found = []
            for sel in instore_probe_selectors:
                try:
                    count = self.page.locator(sel).count()
                    if count > 0:
                        instore_found.append({"selector": sel, "count": count})
                except:
                    pass
            
            # Also get visible text in the tab-content area
            try:
                tab_content = self.page.locator(".tab-content")
                if tab_content.count() > 0:
                    visible_text = tab_content.first.inner_text()[:500]
            except:
                pass
            
            # Check if In-store has an error - if so, try direct API call
            instore_has_error = False
            try:
                error_el = self.page.locator("#in-store-panel .error, #in-store-panel [data-testid='order-history-error']")
                if error_el.count() > 0:
                    instore_has_error = True
                    logger.warning("In-store orders unavailable via webpage, trying direct API call")
                    
                    # Try fetching via direct API call
                    api_receipts = self._fetch_instore_via_api(since)
                    if api_receipts:
                        logger.info(f"Successfully fetched {len(api_receipts)} receipts via direct API")
                        return api_receipts
                    else:
                        # API failed too, fall back to Online orders
                        online_tab = self.page.locator("li[role='tab']:has-text('Online'), li:has-text('Online')")
                        if online_tab.count() > 0:
                            online_tab.first.click()
                            time.sleep(2)
            except Exception as err_check:
                pass
            # #endregion
            
            # Get orders via webpage scraping (for online orders or if in-store loaded normally)
            receipts = self._extract_orders(since)
            
            logger.info(f"Fetched {len(receipts)} receipts")
            return receipts
        
        except Exception as e:
            logger.error(f"Failed to fetch receipts: {e}")
            raise ProviderException(f"Failed to fetch receipts: {e}")
    
    def _extract_orders(self, since: datetime) -> List[Dict]:
        """
        Extract orders from the orders page by navigating into each order
        and scraping the full receipt details.
        
        Args:
            since: Only fetch orders from this date onwards
            
        Returns:
            List of fully structured receipt dictionaries
        """
        receipts = []
        processed_orders = set()
        
        try:
            # Wait for orders to load
            try:
                self.page.wait_for_selector("div.order-info-view-container", timeout=10000)
            except Exception as wait_err:
                return []
            
            # First pass: collect order metadata
            orders = self.page.locator("div.order-info-view-container")
            count = orders.count()
            logger.info(f"Found {count} orders on page")
            # #region agent log
            # #endregion
            
            order_infos = []
            for i in range(count):
                try:
                    order = orders.nth(i)
                    
                    # Extract date - handle both "Store purchase on Jan 21, 2026" 
                    # and "Picked up at Nov 27, 8:52 AM" formats
                    date_text = order.locator(".order-status-past").inner_text().strip()
                    
                    # Try to extract date from various formats
                    order_date = self._parse_order_date(date_text)
                    if not order_date:
                        logger.warning(f"Could not parse date from: {date_text}")
                        continue
                    
                    # Skip if before cutoff date
                    if order_date < since:
                        logger.info(f"Order from {order_date} is before cutoff, skipping")
                        continue
                    
                    # Extract summary (e.g., "13 items · $67.09")
                    summary_text = order.locator(".info-view-sub-header").inner_text().strip()
                    parts = summary_text.split("·")
                    num_items_text = parts[0].strip() if len(parts) > 0 else "0 items"
                    total_price_text = parts[1].strip() if len(parts) > 1 else "$0.00"
                    
                    # Generate unique order key
                    order_key = self._generate_order_key(
                        f"{order_date.strftime('%Y-%m-%d')}|{num_items_text}|{total_price_text}"
                    )
                    
                    if order_key in processed_orders:
                        logger.info(f"Order {order_key} already processed, skipping")
                        continue
                    
                    order_infos.append({
                        "index": i,
                        "date": order_date,
                        "num_items_text": num_items_text,
                        "total_price_text": total_price_text,
                        "key": order_key,
                        "date_text": date_text
                    })
                    
                except Exception as e:
                    logger.warning(f"Failed to extract order metadata {i}: {e}")
                    continue
            
            logger.info(f"Collected {len(order_infos)} orders to process")
            # #region agent log
            # #endregion
            
            # Second pass: navigate into each order and scrape details
            for info in order_infos:
                try:
                    # #region agent log
                    # #endregion
                    logger.info(f"Processing order from {info['date']} ({info['key'][:8]}...)")
                    
                    # Re-locate orders (DOM may have changed)
                    self.page.wait_for_selector("div.order-info-view-container")
                    orders = self.page.locator("div.order-info-view-container")
                    order = orders.nth(info["index"])
                    
                    # Click "View details" - try multiple selectors
                    view_details = order.locator("div[aria-label='View details']")
                    selector_used = "div[aria-label='View details']"
                    if view_details.count() == 0:
                        view_details = order.locator("a[data-testid='view-all']")
                        selector_used = "a[data-testid='view-all']"
                    if view_details.count() == 0:
                        view_details = order.locator("a:has-text('View details')")
                        selector_used = "a:has-text('View details')"
                    if view_details.count() == 0:
                        view_details = order.locator("text=View details")
                        selector_used = "text=View details"
                    
                    # #region agent log
                    # #endregion
                    
                    if view_details.count() == 0:
                        logger.warning(f"Could not find View details button for order {info['index']}")
                        continue
                    
                    view_details.click()
                    # #region agent log
                    # #endregion
                    time.sleep(2)
                    
                    # Check if this is an online order (has "View receipt" button) or in-store
                    is_online_order = False
                    view_receipt_btn = self.page.locator("button:has-text('View receipt'), a:has-text('View receipt')")
                    if view_receipt_btn.count() > 0:
                        is_online_order = True
                        # #region agent log
                        # #endregion
                        view_receipt_btn.first.click()
                        time.sleep(2)
                    
                    # Wait for receipt details to load - try both selectors
                    receipt_loaded = False
                    try:
                        # Try in-store selector first
                        self.page.wait_for_selector(
                            ".instore-receipt-details_item-wrapper__F_eT5",
                            timeout=5000
                        )
                        receipt_loaded = True
                        # #region agent log
                        # #endregion
                    except Exception:
                        pass
                    
                    if not receipt_loaded:
                        try:
                            # Try online order selector - look for item rows
                            self.page.wait_for_selector(
                                ".order-details-item, [data-testid='order-item'], .product-item-row",
                                timeout=5000
                            )
                            receipt_loaded = True
                            is_online_order = True
                            # #region agent log
                            # #endregion
                        except Exception as detail_err:
                            logger.warning(f"Receipt details did not load for order {info['index']}")
                            self._navigate_back_to_orders()
                            continue
                    
                    # Scrape the receipt items based on order type
                    if is_online_order:
                        items = self._scrape_online_order_items()
                    else:
                        items = self._scrape_receipt_items()
                    # #region agent log
                    # #endregion
                    
                    # Extract order metadata from the detail page
                    order_metadata = self._extract_order_metadata()
                    
                    # Parse total amount
                    total_amount = self._parse_price(info["total_price_text"])
                    
                    # Build the receipt structure
                    receipt = {
                        "order_id": info["key"],
                        "order_date": info["date"].strftime("%Y-%m-%d"),
                        "total_amount": total_amount,
                        "num_items": len(items),
                        "items": items,
                        "metadata": {
                            "source": "web_scrape",
                            "scraped_at": datetime.utcnow().isoformat(),
                            "store_address": order_metadata.get("store_address"),
                            "original_date_text": info["date_text"]
                        }
                    }
                    
                    receipts.append(receipt)
                    processed_orders.add(info["key"])
                    logger.info(f"Scraped {len(items)} items from order {info['key'][:8]}...")
                    
                    # Navigate back to orders list
                    self._navigate_back_to_orders()
                    time.sleep(2)
                    
                except Exception as e:
                    logger.error(f"Failed to process order {info.get('key', 'unknown')}: {e}")
                    # Try to navigate back to orders list
                    try:
                        self._navigate_back_to_orders()
                    except Exception:
                        pass
                    continue
            
            return receipts
            
        except Exception as e:
            logger.error(f"Failed to extract orders: {e}")
            return receipts
    
    def _parse_order_date(self, date_text: str) -> Optional[datetime]:
        """
        Parse order date from various formats.
        
        Args:
            date_text: Date text like "Store purchase on Jan 21, 2026" or 
                      "Picked up at Nov 27, 8:52 AM"
        
        Returns:
            Parsed datetime or None if parsing fails
        """
        try:
            # Try format: "Store purchase on Jan 21, 2026" (match case-insensitively)
            if "on " in date_text.lower():
                parts = re.split(r"\s+on\s+", date_text, maxsplit=1, flags=re.IGNORECASE)
                date_part = parts[1].strip() if len(parts) > 1 else date_text
                # Remove any trailing time info
                date_part = re.sub(r'\s+\d{1,2}:\d{2}\s*(AM|PM)?', '', date_part, flags=re.IGNORECASE)
                return datetime.strptime(date_part.strip(), "%b %d, %Y")
            
            # Try format: "Picked up at Nov 27, 8:52 AM" (no year; infer to avoid year-boundary bugs; match case-insensitively)
            if "at " in date_text.lower():
                parts = re.split(r"\s+at\s+", date_text, maxsplit=1, flags=re.IGNORECASE)
                date_part = parts[1].strip() if len(parts) > 1 else date_text
                # Extract just the date part (Nov 27)
                match = re.search(r'([A-Za-z]{3})\s+(\d{1,2})', date_part)
                if match:
                    month_day = f"{match.group(1)} {match.group(2)}"
                    now = datetime.now()
                    parsed = datetime.strptime(f"{month_day}, {now.year}", "%b %d, %Y")
                    # If that date is in the future (e.g. Dec order parsed in Jan next year), use previous year
                    if parsed > now:
                        parsed = datetime.strptime(f"{month_day}, {now.year - 1}", "%b %d, %Y")
                    return parsed
            
            return None
            
        except Exception as e:
            logger.warning(f"Failed to parse date '{date_text}': {e}")
            return None
    
    def _generate_order_key(self, key_string: str) -> str:
        """Generate a unique order key from order details."""
        return hashlib.md5(key_string.encode()).hexdigest()
    
    def _scrape_receipt_items(self) -> List[Dict]:
        """
        Scrape all items from the current receipt detail page.
        
        Returns:
            List of item dictionaries with name, price, quantity, unit, category
        """
        items = []
        current_category = "UNKNOWN"
        
        try:
            # Get all category wrappers
            wrappers = self.page.locator(".instore-receipt-details_item-wrapper__F_eT5")
            wrapper_count = wrappers.count()
            
            logger.info(f"Found {wrapper_count} category wrappers")
            
            for i in range(wrapper_count):
                wrapper = wrappers.nth(i)
                
                # Get category name from badge
                badge = wrapper.locator(".instore-receipt-details_badge__YD7YV")
                if badge.count() > 0:
                    current_category = badge.inner_text().strip()
                    logger.debug(f"Processing category: {current_category}")
                
                # Skip "Additional Discounts" section
                if "discount" in current_category.lower():
                    continue
                
                # Get all item containers (div.pt-2 that contain item rows)
                item_containers = wrapper.locator("div.pt-2")
                
                for j in range(item_containers.count()):
                    try:
                        container = item_containers.nth(j)
                        
                        # Look for item name
                        name_el = container.locator(
                            ".instore-receipt-details_item-name-wrapper__btwYa"
                        )
                        if name_el.count() == 0:
                            continue
                        
                        name = name_el.inner_text().strip()
                        if not name:
                            continue
                        
                        # Get the row with quantity and price
                        row = container.locator("div.row").first
                        
                        # Extract quantity and price from caption elements
                        captions = row.locator(
                            ".instore-receipt-details_typography-caption__tECPC"
                        )
                        
                        qty_text = ""
                        price_text = ""
                        
                        if captions.count() >= 2:
                            qty_text = captions.nth(0).inner_text().strip()
                            price_text = captions.nth(1).inner_text().strip()
                        elif captions.count() == 1:
                            # Try to determine if it's qty or price
                            text = captions.nth(0).inner_text().strip()
                            if "$" in text:
                                price_text = text
                                qty_text = "1"
                            else:
                                qty_text = text
                        
                        # Parse quantity
                        quantity, unit = self._parse_quantity(qty_text)
                        
                        # Parse price
                        price = self._parse_price(price_text)
                        
                        # Try to extract regular price and savings
                        regular_price = None
                        savings = None
                        
                        reg_price_el = container.locator(
                            ".instore-receipt-details_typography-item-reg-price__iSxTD"
                        )
                        if reg_price_el.count() >= 2:
                            reg_price_text = reg_price_el.nth(1).inner_text().strip()
                            regular_price = self._parse_price(reg_price_text)
                        
                        savings_el = container.locator(
                            ".instore-receipt-details_typography-item-savings__ALfwy"
                        )
                        if savings_el.count() >= 2:
                            savings_text = savings_el.nth(1).inner_text().strip()
                            savings = abs(self._parse_price(savings_text))
                        
                        items.append({
                            "name": name,
                            "price": price,
                            "quantity": quantity,
                            "unit": unit,
                            "category": current_category,
                            "regular_price": regular_price,
                            "savings": savings
                        })
                        
                    except Exception as e:
                        logger.warning(f"Failed to extract item {j} in category {current_category}: {e}")
                        continue
            
            return items
            
        except Exception as e:
            logger.error(f"Failed to scrape receipt items: {e}")
            return items
    
    def _scrape_online_order_items(self) -> List[Dict[str, Any]]:
        """
        Scrape items from an online order receipt page.
        Online orders have a different structure than in-store receipts.
        
        Returns:
            List of item dictionaries
        """
        items = []
        
        try:
            # Try multiple possible selectors for online order items
            # Common patterns: product cards, item rows, list items
            item_selectors = [
                ".product-item-row",
                "[data-testid='order-item']",
                ".order-item",
                ".receipt-item",
                "div[class*='product']",
                "div[class*='item-card']",
            ]
            
            item_elements = None
            used_selector = None
            
            for selector in item_selectors:
                elements = self.page.locator(selector)
                count = elements.count()
                if count > 0:
                    item_elements = elements
                    used_selector = selector
                    break
            
            # #region agent log
            item_count = item_elements.count() if item_elements else 0
            # #endregion
            
            if not item_elements or item_elements.count() == 0:
                # Fallback: try to get page text and parse it
                logger.warning("Could not find item elements with known selectors, trying text extraction")
                
                # Get all visible text on page for inspection
                page_text = self.page.inner_text("body")[:2000]
                # #region agent log
                # #endregion
                return items
            
            # Extract item data from each element
            for i in range(item_elements.count()):
                try:
                    element = item_elements.nth(i)
                    text = element.inner_text().strip()
                    
                    if not text:
                        continue
                    
                    # Try to parse item name, quantity, and price from text
                    # Format varies but often: "Product Name\nQty: X\n$Y.YY"
                    lines = [l.strip() for l in text.split('\n') if l.strip()]
                    
                    if len(lines) == 0:
                        continue
                    
                    name = lines[0]
                    quantity = 1
                    price = 0.0
                    
                    for line in lines[1:]:
                        # Check for price
                        if '$' in line:
                            price = self._parse_price(line)
                        # Check for quantity
                        elif 'qty' in line.lower() or line.isdigit():
                            try:
                                qty_match = re.search(r'(\d+)', line)
                                if qty_match:
                                    quantity = int(qty_match.group(1))
                            except:
                                pass
                    
                    items.append({
                        "name": name,
                        "price": price,
                        "quantity": quantity,
                        "unit": "count",
                        "category": "Online Order",
                        "regular_price": None,
                        "savings": None
                    })
                    
                except Exception as e:
                    logger.warning(f"Failed to extract online item {i}: {e}")
                    continue
            
            # #region agent log
            # #endregion
            
            return items
            
        except Exception as e:
            logger.error(f"Failed to scrape online order items: {e}")
            return items
    
    def _parse_quantity(self, qty_text: str) -> Tuple[float, str]:
        """
        Parse quantity text into amount and unit.
        
        Args:
            qty_text: Quantity text like "1", "0.62 lb", "2 oz"
            
        Returns:
            Tuple of (amount, unit)
        """
        if not qty_text:
            return (1, "count")
        
        qty_text = qty_text.strip().lower()
        
        # Check for weight units
        weight_patterns = [
            (r'([\d.]+)\s*lb', 'lb'),
            (r'([\d.]+)\s*oz', 'oz'),
            (r'([\d.]+)\s*kg', 'kg'),
            (r'([\d.]+)\s*g\b', 'g'),
        ]
        
        for pattern, unit in weight_patterns:
            match = re.search(pattern, qty_text)
            if match:
                try:
                    return (float(match.group(1)), unit)
                except ValueError:
                    pass
        
        # Plain count
        try:
            # Extract just the number
            match = re.search(r'([\d.]+)', qty_text)
            if match:
                amount = float(match.group(1))
                # Convert to int if it's a whole number
                if amount == int(amount):
                    amount = int(amount)
                return (amount, "count")
        except ValueError:
            pass
        
        return (1, "count")
    
    def _parse_price(self, price_text: str) -> float:
        """
        Parse price text into a float.
        
        Args:
            price_text: Price text like "$3.59", "$67.09", "-$1.00"
            
        Returns:
            Price as float
        """
        if not price_text:
            return 0.0
        
        try:
            # Remove currency symbols and clean up
            cleaned = price_text.replace("$", "").replace(",", "").strip()
            # Extract the number (handle negative)
            match = re.search(r'-?([\d.]+)', cleaned)
            if match:
                value = float(match.group(1))
                if "-" in price_text:
                    value = -value
                return value
        except (ValueError, AttributeError):
            pass
        
        return 0.0
    
    def _extract_order_metadata(self) -> Dict:
        """
        Extract additional order metadata from the receipt detail page.
        
        Returns:
            Dictionary with store_address and other metadata
        """
        metadata = {}
        
        try:
            # Get store address
            address_el = self.page.locator(
                "div[data-testid='instore-receipt-banner-address']"
            )
            if address_el.count() > 0:
                metadata["store_address"] = address_el.inner_text().strip()
        except Exception:
            pass
        
        return metadata
    
    def _navigate_back_to_orders(self) -> None:
        """Navigate back to the orders list page."""
        try:
            # Try clicking the Back button
            back_btn = self.page.locator(".backbuttonstyles")
            if back_btn.count() > 0:
                back_btn.first.click()
                time.sleep(1)
                
                # May need to click Back again or "Purchases" to get to list
                back_btn = self.page.locator(".backbuttonstyles")
                if back_btn.count() > 0:
                    # Check if we're back at the list
                    orders = self.page.locator("div.order-info-view-container")
                    if orders.count() == 0:
                        back_btn.first.click()
                        time.sleep(1)
            
            # Wait for orders to be visible
            self.page.wait_for_selector("div.order-info-view-container", timeout=10000)
            
        except Exception as e:
            logger.warning(f"Error navigating back to orders: {e}")
            # Fallback: navigate directly to orders page
            try:
                self.page.goto("https://www.safeway.com/order-account/orders")
                time.sleep(3)
            except Exception:
                pass
    
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
            
            # #region agent log
            # #endregion
            
            # Wait a moment for page to stabilize
            self.page.wait_for_timeout(1000)
            
            # Safeway uses 6 separate input boxes for OTP (one per digit)
            # The modal has class patterns we can use for specificity
            otp_inputs = None
            found_method = None
            
            # Try to find 6 individual OTP input boxes within the verification modal
            # Be specific to avoid matching search boxes or other inputs
            multi_input_selectors = [
                # Target inputs inside the OTP/verification modal specifically
                ".modal input[maxlength='1']",
                ".verify-device input[maxlength='1']",
                ".otp-container input",
                "div[class*='otp'] input",
                "div[class*='verification'] input[maxlength='1']",
                # Fallback to any single-char inputs but filter later
                "input[maxlength='1'][type='tel']",
                "input[maxlength='1'][type='text']",
            ]
            
            for selector in multi_input_selectors:
                try:
                    inputs = self.page.query_selector_all(selector)
                    # Filter to visible inputs only and ensure we have exactly 6
                    visible_inputs = [inp for inp in inputs if inp.is_visible()]
                    if visible_inputs and len(visible_inputs) >= 6:
                        otp_inputs = visible_inputs[:6]  # Take first 6 visible inputs
                        found_method = f"multi-input: {selector} (found {len(visible_inputs)} visible)"
                        break
                except Exception:
                    continue
            
            # #region agent log
            # #endregion
            
            mfa_input = None  # Set in single-input path; used for Enter fallback after submit
            if otp_inputs and len(otp_inputs) >= 6:
                # Type into 6 individual input boxes using type() for proper event triggering
                logger.info(f"Found {len(otp_inputs)} OTP input boxes, typing code")
                
                # Click first input to focus
                otp_inputs[0].click()
                self.page.wait_for_timeout(200)
                
                # Type all 6 digits - Safeway's JS should auto-advance focus
                for i, digit in enumerate(mfa_code[:6]):
                    try:
                        # Use type() instead of fill() to trigger proper keyboard events
                        self.page.keyboard.type(digit)
                        self.page.wait_for_timeout(150)  # Small delay for JS to process
                    except Exception as e:
                        logger.warning(f"Error typing OTP digit {i}: {e}")
                
                # #region agent log
                # #endregion
            else:
                # Fallback: try single input field selectors
                mfa_input = None
                found_selector = None
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
                            found_selector = selector
                            break
                    except Exception:
                        continue
                
                # #region agent log
                # #endregion
                
                if not mfa_input:
                    logger.error("Could not locate MFA input field")
                    return False
                
                # Clear and enter MFA code
                mfa_input.click()
                mfa_input.fill("")
                mfa_input.type(mfa_code)
                
                # #region agent log
                # #endregion
            
            # Submit the form - Safeway uses "Sign In" button in OTP modal
            submit_selectors = [
                "button:has-text('Sign In')",  # Safeway's OTP submit button
                "button[type='submit']",
                "button:has-text('Verify')",
                "button:has-text('Submit')",
                "button:has-text('Continue')",
                "input[type='submit']",
                "button[data-testid*='submit']",
                "button[data-testid*='verify']"
            ]
            
            submitted = False
            submit_selector_used = None
            for selector in submit_selectors:
                try:
                    submit_button = self.page.wait_for_selector(selector, timeout=2000)
                    if submit_button:
                        submit_selector_used = selector
                        submit_button.click()
                        submitted = True
                        break
                except Exception:
                    continue
            
            # #region agent log
            # #endregion
            
            if not submitted and mfa_input:
                # Try pressing Enter on the input field (only when single-input path was used)
                mfa_input.press("Enter")
            
            # #region agent log
            # #endregion
            
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
                        # #region agent log
                        # #endregion
                        return True
                except Exception:
                    continue
            
            # Check if we've been redirected away from the login page
            current_url = self.page.url
            if "safeway.com" in current_url and "login" not in current_url.lower():
                logger.info("MFA verification successful (URL redirect)")
                # #region agent log
                # #endregion
                return True
            
            # Check for specific MFA error messages (not generic page elements)
            mfa_error_indicators = [
                "text=Invalid code",
                "text=Incorrect code",
                "text=Verification code is incorrect",
                "text=Please enter a valid code"
            ]
            
            found_error = None
            for indicator in mfa_error_indicators:
                try:
                    element = self.page.wait_for_selector(indicator, timeout=1000)
                    if element:
                        found_error = indicator
                        logger.warning("MFA verification failed - found error indicator")
                        # #region agent log
                        # #endregion
                        return False
                except Exception:
                    continue
            
            # #region agent log
            # #endregion
            
            # Could not determine result
            logger.warning("Could not determine MFA verification result")
            return False
            
        except Exception as e:
            logger.error(f"MFA verification error: {e}", exc_info=True)
        return False
    

