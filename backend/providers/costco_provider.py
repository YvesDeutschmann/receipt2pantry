"""Costco provider implementation"""

import base64
import hashlib
import json
import random
import re
import time
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from backend.providers.playwright_provider import PlaywrightProvider
from backend.providers.provider_registry import register_provider
from backend.utils.costco_receipt_extraction import (
    extract_costco_order_date,
    extract_costco_order_id,
    extract_costco_total,
)
from backend.utils.exceptions import AuthenticationException, ProviderException, MFARequiredException
from backend.utils.logger import get_logger
from backend.config import Config

logger = get_logger(__name__)

# Costco API Configuration
COSTCO_GRAPHQL_ENDPOINT = "https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql"
COSTCO_WCS_CLIENT_ID = "4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf"
# Static client-identifier from Costco's Contentstack CMS (site_context.usbc.clientIdentifier).
# Verify via: POST https://azure-na-graphql.contentstack.com/stacks/bltc822c5b479075ef1?environment=production
#   Headers: access_token: <CONTENTSTACK_ACCESS_TOKEN from env>
#   Body: {"query":"query($l:String!){all_Configuration_Setting(locale:$l where:{enabled_applications:{applications:\"my.costco.web\"}}){items{configkey custom}}}","variables":{"locale":"prod"}}
COSTCO_CLIENT_IDENTIFIER = "481b1aec-aa3b-454b-b81b-48187e28f205"
CONTENTSTACK_URL = "https://azure-na-graphql.contentstack.com/stacks/bltc822c5b479075ef1"


def verify_costco_client_identifier() -> dict:
    """Verify COSTCO_CLIENT_IDENTIFIER against Costco's Contentstack CMS.
    Returns {"valid": bool, "current": str|None, "expected": str, "error": str|None}
    """
    token = Config.CONTENTSTACK_ACCESS_TOKEN
    if not token:
        return {"valid": False, "current": None, "expected": COSTCO_CLIENT_IDENTIFIER, "error": "CONTENTSTACK_ACCESS_TOKEN not configured"}
    query = {
        "query": 'query($l:String!){all_Configuration_Setting(locale:$l where:{enabled_applications:{applications:"my.costco.web"}}){items{configkey custom}}}',
        "variables": {"locale": "prod"},
    }
    try:
        resp = requests.post(
            f"{CONTENTSTACK_URL}?environment=production",
            json=query,
            headers={
                "access_token": token,
                "content-type": "application/json",
            },
            timeout=15,
        )
        resp.raise_for_status()
        items = resp.json().get("data", {}).get("all_Configuration_Setting", {}).get("items", [])
        for item in items:
            if item.get("configkey") == "site_context":
                custom = item.get("custom", {})
                cid = custom.get("usbc", {}).get("clientIdentifier")
                if cid:
                    return {
                        "valid": cid == COSTCO_CLIENT_IDENTIFIER,
                        "current": cid,
                        "expected": COSTCO_CLIENT_IDENTIFIER,
                        "error": None,
                    }
        return {"valid": False, "current": None, "expected": COSTCO_CLIENT_IDENTIFIER, "error": "site_context config not found"}
    except Exception as e:
        return {"valid": False, "current": None, "expected": COSTCO_CLIENT_IDENTIFIER, "error": str(e)}


# Azure AD B2C Configuration for Costco
COSTCO_B2C_TENANT = "bfc5f2e2-aea6-44ef-abc2-f0c95c397145"
COSTCO_B2C_POLICY = "b2c_1a_sso_wcs_signup_signin_180"
COSTCO_B2C_CLIENT_ID = "a3a5186b-7c89-4b4c-93a8-dd604e930757"
COSTCO_B2C_TOKEN_ENDPOINT = f"https://signin.costco.com/{COSTCO_B2C_TENANT}/oauth2/v2.0/token"

# GraphQL query for warehouse receipts with item details
RECEIPTS_QUERY = """query receiptsWithCounts($startDate: String!, $endDate: String!,$documentType:String!,$documentSubType:String!) {
    receiptsWithCounts(startDate: $startDate, endDate: $endDate,documentType:$documentType,documentSubType:$documentSubType) {
    inWarehouse
    gasStation
    carWash
    gasAndCarWash
    receipts{
    warehouseName receiptType documentType transactionDateTime transactionBarcode transactionType total 
    totalItemCount
    itemArray {  
      itemNumber
      itemDescription01
      itemDescription02
      amount
      unit
    }
    tenderArray {   
      tenderTypeCode
      tenderDescription
      amountTender
    }
    couponArray {  
      upcnumberCoupon
    }  
  }
}
  }"""

# GraphQL query for receipt details


@register_provider("costco")
class CostcoProvider(PlaywrightProvider):
    """Costco grocery provider automation"""
    
    def __init__(self, headless: bool = True, timeout: int = 30000):
        """
        Initialize Costco provider
        
        Args:
            headless: Run browser in headless mode
            timeout: Default timeout for operations in milliseconds
        """
        super().__init__(headless=headless, timeout=timeout)
        self._id_token: Optional[str] = None
    
    @property
    def provider_name(self) -> str:
        return "costco"
    
    def _get_session_file(self) -> str:
        """Get the session file path for Costco"""
        return "costco_session.json"
    
    def _decode_jwt_payload(self, token: str) -> Dict:
        """Decode JWT payload without verification (just to read claims)"""
        try:
            # JWT format: header.payload.signature
            parts = token.split('.')
            if len(parts) != 3:
                return {}
            
            # Decode payload (add padding if needed)
            payload = parts[1]
            padding = 4 - len(payload) % 4
            if padding != 4:
                payload += '=' * padding
            
            decoded = base64.urlsafe_b64decode(payload)
            return json.loads(decoded)
        except Exception as e:
            logger.warning(f"Failed to decode JWT: {e}")
            return {}
    
    def _is_token_expired(self, token: str, buffer_seconds: int = 60) -> bool:
        """Check if token is expired or will expire soon"""
        payload = self._decode_jwt_payload(token)
        exp = payload.get('exp')
        if not exp:
            return True
        
        expiry_time = datetime.fromtimestamp(exp)
        return datetime.now() >= (expiry_time - timedelta(seconds=buffer_seconds))
    
    def _get_api_headers(self, id_token: str, client_identifier: Optional[str] = None) -> Dict[str, str]:
        """Get headers for Costco API requests. Matches browser DevTools cURL - no X-Requested-With (triggers Akamai 403)."""
        cid = client_identifier or COSTCO_CLIENT_IDENTIFIER
        return {
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7",
            "Connection": "keep-alive",
            "Content-Type": "application/json-patch+json",
            "Origin": "https://www.costco.com",
            "Referer": "https://www.costco.com/",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "client-identifier": cid,
            "costco-x-authorization": f"Bearer {id_token}",
            "costco-x-wcs-clientId": COSTCO_WCS_CLIENT_ID,
            "costco.env": "ecom",
            "costco.service": "restOrders",
            "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
        }
    
    def _get_b2c_token_endpoint(self, id_token: str) -> str:
        """
        Extract B2C tenant info from idToken and build correct token endpoint.
        
        Args:
            id_token: The idToken JWT to extract issuer information from
        
        Returns:
            The correct Azure AD B2C token endpoint URL
        """
        payload = self._decode_jwt_payload(id_token)
        issuer = payload.get('iss', '')
        
        logger.debug(f"Extracting token endpoint from issuer: {issuer}")
        
        if 'signin.costco.com' in issuer:
            parts = issuer.rstrip('/').split('/')
            tenant = parts[-2] if len(parts) > 1 and parts[-1] == 'v2.0' else parts[-1]
            endpoint = f"https://signin.costco.com/{tenant}/{COSTCO_B2C_POLICY}/oauth2/v2.0/token"
            logger.debug(f"Built custom domain endpoint: {endpoint}")
            return endpoint
        elif 'b2clogin.com' in issuer:
            parts = issuer.rstrip('/').split('/')
            tenant = parts[-2] if len(parts) > 1 and parts[-1] == 'v2.0' else parts[-1]
            endpoint = f"https://{tenant}.b2clogin.com/{tenant}/{COSTCO_B2C_POLICY}/oauth2/v2.0/token"
            logger.debug(f"Built standard B2C endpoint: {endpoint}")
            return endpoint
        
        endpoint = f"https://signin.costco.com/{COSTCO_B2C_TENANT}/{COSTCO_B2C_POLICY}/oauth2/v2.0/token"
        logger.warning(f"Could not parse issuer {issuer}, using fallback endpoint: {endpoint}")
        return endpoint
    
    def _refresh_id_token(self, refresh_token: str, id_token: Optional[str] = None, client_id: Optional[str] = None) -> Dict[str, str]:
        """Refresh the idToken using the stored refresh token."""
        if not id_token:
            raise AuthenticationException("idToken is required to determine the correct token endpoint")
        
        client_id = client_id or COSTCO_B2C_CLIENT_ID
        token_endpoint = self._get_b2c_token_endpoint(id_token)
        logger.info(f"Using token refresh endpoint: {token_endpoint}")
        
        data = {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": refresh_token,
            "scope": f"openid offline_access {client_id}"
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
        }
        
        try:
            response = requests.post(token_endpoint, data=data, headers=headers, timeout=30)
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "No error details"
                logger.error(f"Token refresh failed with status {response.status_code}: {error_text}")
                raise AuthenticationException(f"Token refresh failed: {response.status_code} - {error_text}")
            
            tokens = response.json()
            if not tokens.get("id_token"):
                raise AuthenticationException("Token refresh response missing id_token")
            
            result = {
                "idToken": tokens.get("id_token"),
                "refreshToken": tokens.get("refresh_token") or refresh_token,
            }
            if tokens.get("access_token"):
                result["accessToken"] = tokens.get("access_token")
            logger.info("Successfully refreshed Costco idToken")
            return result
        except AuthenticationException:
            raise
        except Exception as e:
            logger.error(f"Unexpected error during token refresh: {e}")
            raise AuthenticationException(f"Token refresh failed: {str(e)}")
    
    def fetch_receipts_via_api(self, id_token: str, days: int = 90, client_identifier: Optional[str] = None) -> List[Dict]:
        """Fetch receipts directly via Costco's GraphQL API"""
        logger.info(f"Fetching Costco receipts via API for last {days} days")
        
        if self._is_token_expired(id_token):
            raise AuthenticationException("The provided idToken has expired. Please provide a fresh token.")
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        start_str = start_date.strftime("%m/%d/%Y")
        end_str = end_date.strftime("%m/%d/%Y")
        
        payload = {
            "query": RECEIPTS_QUERY,
            "variables": {
                "startDate": start_str,
                "endDate": end_str,
                "documentType": "all",
                "documentSubType": "all"
            }
        }
        headers = self._get_api_headers(id_token, client_identifier)
        
        try:
            response = requests.post(
                COSTCO_GRAPHQL_ENDPOINT,
                data=json.dumps(payload),
                headers=headers,
                timeout=30
            )
            if response.status_code == 401:
                error_text = response.text[:500] if response.text else "No error details"
                logger.error(f"Costco API returned 401 Unauthorized. Response: {error_text}")
                raise AuthenticationException("Token is invalid or expired")
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "No error details"
                logger.error(f"Costco API returned status {response.status_code}. Response: {error_text}")
                raise ProviderException(f"Costco API returned status {response.status_code}: {error_text[:200]}")
            
            data = response.json()
            if 'errors' in data:
                logger.error(f"GraphQL errors: {data['errors']}")
                raise ProviderException(f"GraphQL error: {data['errors']}")
            
            receipts_data = data.get('data', {}).get('receiptsWithCounts', {})
            raw_receipts = receipts_data.get('receipts', [])
            all_count = len(raw_receipts)
            raw_receipts = [r for r in raw_receipts if r.get('receiptType', '').lower() == 'warehouse']
            logger.info(f"Found {all_count} total receipts via API, {len(raw_receipts)} grocery (warehouse) after filtering out gas/carwash")
            
            receipts = []
            for raw in raw_receipts:
                receipt = self._parse_api_receipt(raw)
                if receipt:
                    receipts.append(receipt)
            return receipts
        except requests.RequestException as e:
            logger.error(f"API request failed: {e}")
            raise ProviderException(f"Failed to fetch receipts from Costco API: {e}")
    
    def _parse_api_receipt(self, raw: Dict) -> Optional[Dict]:
        """Parse a raw API receipt into standard format"""
        try:
            # Parse transaction date
            trans_date_str = raw.get('transactionDateTime', '')
            try:
                # Format: "2025-01-15T14:30:00" or similar
                trans_date = datetime.fromisoformat(trans_date_str.replace('Z', '+00:00'))
            except:
                trans_date = datetime.now()
            
            # Parse items - use itemDescription01/02 as the description
            items = []
            for item in raw.get('itemArray', []):
                # Combine description fields
                desc1 = item.get('itemDescription01', '') or ''
                desc2 = item.get('itemDescription02', '') or ''
                name = f"{desc1} {desc2}".strip() or 'Unknown Item'
                
                items.append({
                    'name': name,
                    'quantity': float(item.get('unit', 1) or 1),
                    'unit_price': 0,  # Not available in basic query
                    'price': float(item.get('amount', 0) or 0),  # Fixed: use 'price' instead of 'total_price'
                    'item_number': item.get('itemNumber', ''),
                    'category': 'GROCERY',  # Default category
                })
            
            # Calculate totals
            total = float(raw.get('total', 0))
            
            # Use transactionBarcode when present; otherwise generate unique fallback to avoid
            # UNIQUE(order_id) constraint violations when multiple receipts lack this field
            order_id = raw.get('transactionBarcode', '').strip()
            if not order_id:
                fallback_data = json.dumps(raw, sort_keys=True, default=str)
                order_id = f"COSTCO_{hashlib.md5(fallback_data.encode()).hexdigest()[:12]}"
            
            receipt = {
                'store_name': raw.get('warehouseName', 'Costco'),
                'store_location': raw.get('warehouseName', ''),
                'order_id': order_id,
                'order_date': trans_date.strftime('%Y-%m-%d'),  # Fixed: add order_date field
                'total_amount': total,  # Fixed: use total_amount instead of total
                'date': trans_date.strftime('%Y-%m-%d'),
                'time': trans_date.strftime('%H:%M:%S'),
                'total': total,
                'items': items,
                'transaction_id': order_id,
                'receipt_type': raw.get('receiptType', 'warehouse'),
                'document_type': raw.get('documentType', ''),
                'raw_data': raw,  # Keep raw data for debugging
            }
            
            return receipt
            
        except Exception as e:
            logger.warning(f"Failed to parse receipt: {e}")
            return None
    
    def extract_tokens_from_browser(self) -> Dict[str, str]:
        """
        Extract authentication tokens from browser localStorage after login
        
        Returns:
            Dictionary with 'idToken' and optionally 'refreshToken'
        """
        if not self.page:
            raise ProviderException("Browser not initialized")
        
        try:
            # Navigate to costco.com if not already there
            if "costco.com" not in self.page.url:
                self.page.goto("https://www.costco.com/", wait_until="networkidle")
                time.sleep(2)
            
            # Extract tokens from localStorage
            tokens = self.page.evaluate("""
                () => {
                    const result = {};
                    
                    // Get idToken
                    const idToken = localStorage.getItem('idToken');
                    if (idToken) {
                        result.idToken = idToken;
                    }
                    
                    // Get clientID
                    const clientId = localStorage.getItem('clientID');
                    if (clientId) {
                        result.clientId = clientId;
                    }
                    
                    // Look for refresh token in MSAL storage
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && key.includes('RefreshToken')) {
                            try {
                                const value = JSON.parse(localStorage.getItem(key));
                                if (value && value.secret) {
                                    result.refreshToken = value.secret;
                                    result.refreshTokenClientId = value.clientId;
                                    break;
                                }
                            } catch (e) {}
                        }
                    }
                    
                    return result;
                }
            """)
            
            logger.info(f"Extracted tokens: idToken={'yes' if tokens.get('idToken') else 'no'}, "
                       f"refreshToken={'yes' if tokens.get('refreshToken') else 'no'}")
            
            return tokens
            
        except Exception as e:
            logger.error(f"Failed to extract tokens: {e}")
            raise ProviderException(f"Failed to extract tokens from browser: {e}")
    
    def login(self, credentials: Dict, session_id: Optional[str] = None) -> bool:
        """
        Login to Costco account
        
        Args:
            credentials: Dictionary with 'username' and 'password'
            session_id: Optional session ID for resuming an existing login session
        
        Returns:
            True if login successful
        
        Raises:
            AuthenticationException: If login fails
            MFARequiredException: If MFA is required
        """
        try:
            logger.info("Starting Costco login process")
            
            username = credentials.get("username")
            password = credentials.get("password")
            
            if not username or not password:
                raise AuthenticationException("Missing username or password")
            
            self._start_browser()
            
            
            # Navigate to Costco main page and wait for it to fully load
            self.page.goto("https://www.costco.com/", wait_until="networkidle")
            time.sleep(3)  # Extra wait for any redirects or dynamic content
            
            # Check if already logged in
            if self._is_logged_in():
                logger.info("Already logged in")
                return True
            
            # Check if we're already on a signin page or if there's an access denied
            current_url = self.page.url
            page_content = self.page.content()
            
            if "Access Denied" in page_content:
                raise AuthenticationException("Access denied on main page - bot detection is blocking access")
            
            # Click the sign-in button to access the signin flow
            logger.info("Clicking Sign In button to access signin page")
            
            # Add realistic mouse movement and human-like behavior
            try:
                self.page.mouse.move(random.randint(100, 800), random.randint(100, 600))
                time.sleep(random.uniform(1.0, 2.0))
            except Exception as mouse_error:
                logger.warning(f"Mouse movement failed: {mouse_error}")
            
            # Find and click the sign-in button
            try:
                sign_in_btn = self.page.wait_for_selector(
                    '[data-testid="Text_search-strip-member-links-desktop-signin-desktop"]',
                    timeout=10000
                )
                
                # Click with human-like delay
                sign_in_btn.click()
                time.sleep(random.uniform(3.0, 5.0))
                
                # Wait for navigation to complete
                self.page.wait_for_load_state("networkidle", timeout=30000)
                
            except Exception as click_error:
                raise AuthenticationException(f"Failed to click signin button: {click_error}")
            
            
            # Check final page state
            final_content = self.page.content()
            if "Access Denied" in final_content:
                logger.warning("Costco signin blocked by bot detection - attempting manual signin fallback")
                
                
                # Log the bot detection but don't raise exception immediately
                # The API approach can still work if we have tokens from a browser session
                logger.warning("Bot detection detected - API approach may still work with existing tokens")
            
            # Check if signin form is available
            try:
                signin_input = self.page.query_selector("input#signInName")
                if not signin_input:
                    raise AuthenticationException("Signin form not found - unexpected page structure")
            except Exception as form_error:
                raise AuthenticationException(f"Error checking signin form: {form_error}")

            # Fill email
            logger.info("Filling email")
            username_input = self.page.wait_for_selector("input#signInName", timeout=10000)
            username_input.fill(username)
            
            # Fill password
            logger.info("Filling password")
            password_input = self.page.wait_for_selector("input#password", timeout=10000)
            password_input.fill(password)
            
            # Click submit button
            logger.info("Clicking submit button")
            sign_in_button = self.page.wait_for_selector("button#next", timeout=10000)
            sign_in_button.click()
            
            # Wait for navigation or MFA prompt
            logger.info("Waiting for login response")
            self.page.wait_for_timeout(5000)
            
            # Check for MFA prompt
            if self._detect_mfa_prompt():
                logger.info("MFA verification required")
                raise MFARequiredException("Multi-factor authentication required to complete login")
            
            # Verify login success - wait for redirect back to costco.com
            try:
                self.page.wait_for_url("**costco.com/**", timeout=10000)
            except Exception:
                pass
            
            # Check for error messages
            error_selectors = [
                "div[role='alert']",
                ".error-message",
                "[class*='error']",
                "div:has-text('incorrect')",
                "div:has-text('Invalid')",
                "div:has-text('incorrect email')",
                "div:has-text('incorrect password')"
            ]
            for selector in error_selectors:
                try:
                    error_element = self.page.locator(selector).first
                    if error_element.count() > 0 and error_element.is_visible():
                        error_text = error_element.inner_text().strip()
                        if error_text:
                            raise AuthenticationException(f"Login failed: {error_text}")
                except Exception:
                    continue
            
            # Verify login success
            if not self._is_logged_in():
                raise AuthenticationException("Login verification failed")
            
            # Save session
            self.context.storage_state(path=self._get_session_file())
            logger.info("Login successful")
            return True
        
        except MFARequiredException:
            raise
        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise AuthenticationException(f"Login failed: {e}")
    
    def _is_logged_in(self) -> bool:
        """Check if user is already logged in"""
        try:
            # Check for "Orders & Returns" button (only visible when logged in)
            orders_btn = self.page.locator('[data-testid="Text_OrdersAndReturns"]')
            if orders_btn.count() > 0 and orders_btn.is_visible():
                return True
            
            # Fallback: check for other logged-in indicators
            account_indicators = [
                "a[href*='SignOut']",
                "a:has-text('Sign Out')",
                "[data-testid='account-menu']",
                "span:has-text('My Account')"
            ]
            
            for selector in account_indicators:
                try:
                    element = self.page.locator(selector).first
                    if element.count() > 0 and element.is_visible():
                        return True
                except Exception:
                    continue
            
            return False
        except Exception:
            return False
    
    def _detect_mfa_prompt(self) -> bool:
        """
        Detect if MFA verification is required
        
        Returns:
            True if MFA prompt is detected, False otherwise
        """
        try:
            # Look for MFA/verification code input fields
            mfa_selectors = [
                "input[name*='code']",
                "input[name*='verification']",
                "input[placeholder*='code']",
                "input[placeholder*='Code']",
                "input[type='tel']",
                "[data-testid*='mfa']",
                "[data-testid*='verification']"
            ]
            
            for selector in mfa_selectors:
                try:
                    element = self.page.locator(selector).first
                    if element.count() > 0 and element.is_visible():
                        logger.info(f"MFA detected: found input with selector {selector}")
                        return True
                except Exception:
                    continue
            
            # Check for MFA-related text
            mfa_text_indicators = [
                "text=verification code",
                "text=Verification Code",
                "text=enter code",
                "text=Enter Code"
            ]
            
            for indicator in mfa_text_indicators:
                try:
                    element = self.page.locator(indicator).first
                    if element.count() > 0 and element.is_visible():
                        logger.info("MFA detected: found verification code text")
                        return True
                except Exception:
                    continue
            
            return False
        except Exception as e:
            logger.warning(f"Error detecting MFA prompt: {e}")
            return False
    
    def handle_mfa(self, mfa_code: str) -> bool:
        """
        Handle MFA verification
        
        Args:
            mfa_code: MFA code from user
        
        Returns:
            True if verification successful
        """
        return self._perform_mfa_verification(mfa_code)
    
    def _perform_mfa_verification(self, mfa_code: str) -> bool:
        """
        Perform the actual MFA verification
        
        Args:
            mfa_code: The MFA verification code from user
        
        Returns:
            True if MFA was successful, False otherwise
        """
        try:
            if not self.page:
                logger.error("Browser page not available")
                return False
            
            self.page.wait_for_timeout(1000)
            
            # Find MFA input field
            mfa_input = None
            mfa_selectors = [
                "input[name*='code']",
                "input[name*='verification']",
                "input[placeholder*='code']",
                "input[type='tel']",
                "input[type='text'][maxlength='6']"
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
            
            # Enter MFA code
            mfa_input.click()
            mfa_input.fill("")
            mfa_input.type(mfa_code)
            
            # Submit
            submit_selectors = [
                "button[type='submit']",
                "button:has-text('Verify')",
                "button:has-text('Continue')",
                "button:has-text('Submit')",
                "input[type='submit']"
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
                mfa_input.press("Enter")
            
            # Wait for response
            self.page.wait_for_timeout(3000)
            
            # Check if verification was successful
            if self._is_logged_in():
                logger.info("MFA verification successful")
                self.context.storage_state(path=self._get_session_file())
                return True
            
            # Check for error messages
            error_selectors = [
                "div[role='alert']",
                ".error-message",
                "[class*='error']",
                "div:has-text('Invalid')",
                "div:has-text('incorrect')"
            ]
            
            for selector in error_selectors:
                try:
                    error_element = self.page.locator(selector).first
                    if error_element.count() > 0 and error_element.is_visible():
                        logger.warning("MFA verification failed - found error indicator")
                        return False
                except Exception:
                    continue
            
            logger.warning("Could not determine MFA verification result")
            return False
            
        except Exception as e:
            logger.error(f"MFA verification error: {e}", exc_info=True)
            return False
    
    def _scrape_receipt_modal(self) -> Dict:
        """
        Scrape receipt data from the modal that opens when clicking "View Receipt"
        
        Returns:
            Dictionary with receipt data including items, order_id, date, total
        """
        try:
            # Wait for modal to appear
            logger.info("Waiting for receipt modal to appear")
            self.page.wait_for_selector("table tbody tr", timeout=10000)
            time.sleep(1)  # Give modal time to fully render
            
            # Extract items from table
            items = []
            rows = self.page.locator("table tbody tr")
            row_count = rows.count()
            logger.info(f"Found {row_count} rows in receipt modal")
            
            for i in range(row_count):
                try:
                    row = rows.nth(i)
                    cells = row.locator("td")
                    cell_count = cells.count()
                    
                    if cell_count >= 4:
                        tax_flag = cells.nth(0).inner_text().strip()
                        item_code = cells.nth(1).inner_text().strip()
                        item_name = cells.nth(2).inner_text().strip()
                        price_info = cells.nth(3).inner_text().strip()
                        
                        # Skip header rows or empty rows
                        if not item_code or item_code.isalpha():
                            continue
                        
                        # Parse price from price_info (format: "16.49 N" or "16.49 Y")
                        price_match = re.search(r'(\d+\.\d{2})', price_info)
                        price = float(price_match.group(1)) if price_match else 0.0
                        
                        items.append({
                            'tax_flag': tax_flag,
                            'item_code': item_code,
                            'name': item_name,
                            'raw_name': item_name,  # For parser
                            'price': price,
                            'price_info': price_info,
                            'quantity': 1,  # Costco receipts typically show 1 per line
                            'category': 'GROCERY'  # Default, will be normalized later
                        })
                except Exception as e:
                    logger.warning(f"Failed to extract row {i}: {e}")
                    continue
            
            # Try to extract receipt metadata from modal
            # Look for order ID, date, total in the modal
            order_id = None
            receipt_date = None
            total_amount = 0.0
            
            # Try to find order ID in modal (might be in a header or title)
            modal_text = self.page.locator("body").inner_text()
            
            # Extract order ID (long number pattern)
            order_id_match = re.search(r'(\d{20,})', modal_text)
            if order_id_match:
                order_id = order_id_match.group(1)
            
            # Extract date (format: MM/DD/YYYY)
            date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', modal_text)
            if date_match:
                try:
                    receipt_date = datetime.strptime(date_match.group(1), '%m/%d/%Y')
                except ValueError:
                    pass
            
            # Extract total amount
            total_match = re.search(r'\$(\d+\.\d{2})', modal_text)
            if total_match:
                try:
                    total_amount = float(total_match.group(1))
                except ValueError:
                    pass
            
            # If no total found, sum item prices
            if total_amount == 0.0 and items:
                total_amount = sum(item['price'] for item in items)
            
            logger.info(f"Scraped {len(items)} items from modal, total: ${total_amount}")
            
            return {
                'order_id': order_id or f"COSTCO_{hashlib.md5(modal_text.encode()).hexdigest()[:12]}",
                'receipt_date': receipt_date,
                'total_amount': total_amount,
                'items': items,
                'raw_data': modal_text  # Store full modal text for parser
            }
            
        except Exception as e:
            logger.error(f"Failed to scrape receipt modal: {e}")
            return {
                'order_id': None,
                'receipt_date': None,
                'total_amount': 0.0,
                'items': [],
                'raw_data': ''
            }
    
    def fetch_receipts(self, since: datetime) -> List[Dict]:
        """
        Fetch receipts from Costco account
        
        Uses direct API approach first (faster, more reliable), falls back to browser scraping.
        
        Args:
            since: Fetch receipts from this date onwards
        
        Returns:
            List of receipt dictionaries with scraped receipt data
        
        Raises:
            ProviderException: If fetching fails
        """
        try:
            logger.info(f"Fetching Costco receipts since {since}")
            
            # Calculate days since the 'since' date
            days = (datetime.now() - since).days + 1
            days = max(days, 1)  # At least 1 day
            days = min(days, 365)  # Max 1 year
            
            # Try API approach first if we have a browser session
            if self.page:
                try:
                    logger.info("Attempting to fetch receipts via direct API...")
                    tokens = self.extract_tokens_from_browser()
                    if tokens.get('idToken'):
                        id_token = tokens['idToken']
                        if not self._is_token_expired(id_token):
                            logger.info("Valid token found, using API approach")
                            receipts = self.fetch_receipts_via_api(id_token, days=days)
                            if receipts:
                                logger.info(f"Successfully fetched {len(receipts)} receipts via API")
                                return receipts
                            else:
                                logger.info("API returned no receipts, trying browser scraping")
                        else:
                            logger.info("Token is expired, falling back to browser scraping")
                    else:
                        logger.info("No idToken found in browser, falling back to browser scraping")
                except Exception as api_error:
                    logger.warning(f"API approach failed: {api_error}, falling back to browser scraping")
            
            # Fall back to browser scraping approach
            logger.info("Using browser scraping approach...")
            
            if not self.page:
                raise ProviderException("Browser not started. Call login() first.")
            
            # Navigate to main page if not already there
            if "costco.com/myaccount" not in self.page.url:
                self.page.goto("https://www.costco.com/", wait_until="domcontentloaded")
                time.sleep(2)
            
            # Click "Orders & Returns" button
            logger.info("Clicking Orders & Returns button")
            orders_btn = self.page.wait_for_selector(
                '[data-testid="Text_OrdersAndReturns"]',
                timeout=15000
            )
            orders_btn.click()
            time.sleep(3)
            
            # Click "Warehouse" tab
            logger.info("Clicking Warehouse tab")
            warehouse_tab = self.page.wait_for_selector(
                'div.MuiTypography-root:has-text("Warehouse")',
                timeout=10000
            )
            warehouse_tab.click()
            time.sleep(2)
            
            # Find all receipt cards with "In-Warehouse" label
            # Cards have IDs like "viewRecieptBtn_21074700600732601231155"
            logger.info("Finding In-Warehouse receipts")
            
            # Find all receipt card containers (divs with id starting with "viewRecieptBtn_")
            receipt_card_ids = self.page.locator('[id^="viewRecieptBtn_"]')
            card_count = receipt_card_ids.count()
            logger.info(f"Found {card_count} receipt cards")
            
            # Filter to only In-Warehouse receipts
            in_warehouse_cards = []
            for i in range(card_count):
                card = receipt_card_ids.nth(i)
                # Check if this card has "In-Warehouse" label
                in_warehouse_label = card.locator('[automation-id="In-Warehouse"]')
                if in_warehouse_label.count() > 0:
                    in_warehouse_cards.append(i)
            
            logger.info(f"Found {len(in_warehouse_cards)} In-Warehouse receipts (filtered from {card_count} total)")
            
            receipts = []
            processed_order_ids = set()
            
            for idx, card_index in enumerate(in_warehouse_cards[:50]):  # Limit to 50 receipts max
                try:
                    card = receipt_card_ids.nth(card_index)
                    
                    # Extract receipt date from card
                    # Date is in a div with class .css-9sihfw within the card
                    date_element = card.locator('.css-9sihfw').first
                    receipt_date = None
                    
                    if date_element.count() > 0:
                        date_text = date_element.inner_text().strip()
                        # Parse date format: "01/23/2026 - 11:55am"
                        date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', date_text)
                        if date_match:
                            try:
                                receipt_date = datetime.strptime(date_match.group(1), '%m/%d/%Y')
                            except ValueError:
                                pass
                    
                    # Fallback: extract from card text
                    if not receipt_date:
                        card_text = card.inner_text()
                        date_match = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', card_text)
                        if date_match:
                            try:
                                receipt_date = datetime.strptime(date_match.group(1), '%m/%d/%Y')
                            except ValueError:
                                pass
                    
                    # Skip if date is before cutoff
                    if receipt_date and receipt_date.date() < since.date():
                        logger.debug(f"Skipping receipt from {receipt_date.date()}, before cutoff {since.date()}")
                        continue
                    
                    # Find "View Receipt" button within this card
                    view_receipt_btn = card.locator('[automation-id="ViewInWareHouseReciept"]').first
                    
                    if view_receipt_btn.count() == 0:
                        logger.warning(f"Could not find View Receipt button for card {card_index}")
                        continue
                    
                    logger.info(f"Clicking View Receipt for receipt {idx+1}/{len(in_warehouse_cards)} (date: {receipt_date.date() if receipt_date else 'unknown'})")
                    view_receipt_btn.click()
                    time.sleep(2)  # Wait for modal to open
                    
                    # Extract order ID from card ID (format: viewRecieptBtn_21074700600732601231155)
                    card_id = card.get_attribute('id') or ''
                    order_id_from_card = None
                    if card_id and '_' in card_id:
                        order_id_from_card = card_id.split('_', 1)[1] if '_' in card_id else None
                    
                    # Scrape receipt data from modal
                    receipt_data = self._scrape_receipt_modal()
                    
                    if receipt_data and receipt_data.get('items'):
                        # Use order ID from card ID if available, otherwise from modal
                        order_id = order_id_from_card or receipt_data.get('order_id')
                        
                        # Skip duplicates
                        if order_id and order_id in processed_order_ids:
                            logger.debug(f"Skipping duplicate receipt {order_id}")
                            # Close modal and continue
                            self._close_receipt_modal()
                            continue
                        
                        if order_id:
                            processed_order_ids.add(order_id)
                        
                        # Use scraped date or fallback to extracted date
                        final_date = receipt_data.get('receipt_date') or receipt_date or datetime.now()
                        
                        # Extract total from card if not found in modal
                        total_amount = receipt_data.get('total_amount', 0.0)
                        if total_amount == 0.0:
                            total_element = card.locator('[automation-id="totalPrice"]').first
                            if total_element.count() > 0:
                                total_text = total_element.inner_text()
                                total_match = re.search(r'\$(\d+\.\d{2})', total_text)
                                if total_match:
                                    total_amount = float(total_match.group(1))
                        
                        receipts.append({
                            'order_id': order_id or f"COSTCO_{idx}_{int(time.time())}",
                            'order_date': final_date.strftime('%Y-%m-%d'),
                            'total_amount': total_amount,
                            'num_items': len(receipt_data.get('items', [])),
                            'date': final_date.isoformat(),
                            'store': 'Costco',
                            'items': receipt_data.get('items', []),
                            'raw_data': receipt_data.get('raw_data', ''),
                            'source': 'costco_modal'
                        })
                        
                        logger.info(f"Extracted receipt {order_id} with {len(receipt_data.get('items', []))} items")
                    else:
                        logger.warning(f"No items found in receipt modal for card {card_index}")
                    
                    # Close modal
                    self._close_receipt_modal()
                    time.sleep(1)
                    
                except Exception as e:
                    logger.warning(f"Failed to process receipt card {card_index}: {e}", exc_info=True)
                    # Try to close modal if it's open
                    try:
                        self._close_receipt_modal()
                    except Exception:
                        pass
                    continue
            
            logger.info(f"Fetched {len(receipts)} Costco receipts")
            return receipts
            
        except Exception as e:
            logger.error(f"Failed to fetch Costco receipts: {e}", exc_info=True)
            raise ProviderException(f"Failed to fetch receipts: {e}")
    
    def _close_receipt_modal(self) -> None:
        """Close the receipt modal by pressing Escape or clicking close button"""
        try:
            # Try pressing Escape key
            self.page.keyboard.press("Escape")
            time.sleep(0.5)
            
            # Check if modal is still open, try clicking outside or close button
            modal_open = self.page.locator("table tbody tr").count() > 0
            if modal_open:
                # Try to find and click a close button
                close_selectors = [
                    "button[aria-label='Close']",
                    "button:has-text('Close')",
                    "[class*='close']",
                    "button[class*='MuiIconButton']"
                ]
                for selector in close_selectors:
                    try:
                        close_btn = self.page.locator(selector).first
                        if close_btn.count() > 0 and close_btn.is_visible():
                            close_btn.click()
                            break
                    except Exception:
                        continue
        except Exception as e:
            logger.warning(f"Error closing modal: {e}")
    
    
    def _extract_order_id(self, receipt_text: str) -> str:
        """Extract order/transaction ID from receipt text"""
        extracted_order_id = extract_costco_order_id(receipt_text)
        if extracted_order_id:
            return extracted_order_id

        # Fallback: generate from hash
        return f"COSTCO_{hashlib.md5(receipt_text.encode()).hexdigest()[:12]}"
    
    def _extract_order_date(self, receipt_text: str, fallback_date: Optional[datetime] = None) -> Optional[datetime]:
        """Extract order date from receipt text"""
        return extract_costco_order_date(receipt_text) or fallback_date or datetime.now()
    
    def _extract_total(self, receipt_text: str) -> float:
        """Extract total amount from receipt text"""
        return extract_costco_total(receipt_text)
    
