"""Costco provider implementation"""

import base64
import hashlib
import json
import requests
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.providers.base_provider import BaseProvider
from backend.providers.provider_registry import register_provider
from backend.utils.exceptions import AuthenticationException, ProviderException, MFARequiredException
from backend.utils.logger import get_logger
from backend.utils.costco_receipt_types import is_non_grocery_costco_receipt_type
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


def _mfa_payload_from_graphql_errors(errors: List[Any]) -> Optional[Dict[str, Any]]:
    """If GraphQL errors indicate device verification / MFA, return session id and options."""
    for err in errors:
        if not isinstance(err, dict):
            continue
        msg = (err.get("message") or "").lower()
        ext = err.get("extensions") or {}
        code = str(ext.get("code") or "").upper()
        if code in ("DEVICE_VERIFICATION_REQUIRED", "DEVICE_VERIFICATION") or (
            "device" in msg and "verif" in msg
        ):
            return {
                "message": err.get("message") or "Device verification required",
                "session_id": ext.get("sessionId") or ext.get("session_id"),
                "options": ext.get("verificationOptions") or ext.get("options") or ext,
            }
    return None


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
class CostcoProvider(BaseProvider):
    """Costco grocery provider (token/API path only)"""

    def __init__(self, headless: bool = True, timeout: int = 30000):
        """Accept legacy headless/timeout kwargs as no-ops for call-site compatibility."""
        self._id_token: Optional[str] = None

    @property
    def provider_name(self) -> str:
        return "costco"

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

    def fetch_receipts_via_api(
        self,
        id_token: str,
        days: int = 90,
        client_identifier: Optional[str] = None,
        refresh_token: Optional[str] = None,
        refresh_token_client_id: Optional[str] = None,
        token_refresh_sink: Optional[Dict[str, Any]] = None,
    ) -> List[Dict]:
        """Fetch receipts directly via Costco's GraphQL API.

        On HTTP 401, attempts at most one token refresh (when ``refresh_token`` is provided)
        and retries the GraphQL request once. Surplus 401 responses raise AuthenticationException.
        """
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
                "documentSubType": "all",
            },
        }

        current_id_token = id_token
        current_refresh_token = refresh_token

        def _post_graphql(tok: str) -> requests.Response:
            return requests.post(
                COSTCO_GRAPHQL_ENDPOINT,
                data=json.dumps(payload),
                headers=self._get_api_headers(tok, client_identifier),
                timeout=30,
            )

        try:
            response = _post_graphql(current_id_token)
            if response.status_code == 401 and current_refresh_token:
                new_tokens = self._refresh_id_token(
                    current_refresh_token,
                    id_token=current_id_token,
                    client_id=refresh_token_client_id,
                )
                current_id_token = new_tokens["idToken"]
                current_refresh_token = new_tokens.get("refreshToken") or current_refresh_token
                if token_refresh_sink is not None:
                    token_refresh_sink.update(new_tokens)
                response = _post_graphql(current_id_token)

            if response.status_code == 401:
                error_text = response.text[:500] if response.text else "No error details"
                logger.error(f"Costco API returned 401 Unauthorized. Response: {error_text}")
                raise AuthenticationException("Token is invalid or expired")
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "No error details"
                logger.error(f"Costco API returned status {response.status_code}. Response: {error_text}")
                raise ProviderException(f"Costco API returned status {response.status_code}: {error_text[:200]}")

            data = response.json()
            graphql_errors = data.get("errors") or []
            if graphql_errors:
                mfa = _mfa_payload_from_graphql_errors(graphql_errors)
                if mfa is not None:
                    raise MFARequiredException(
                        mfa["message"],
                        session_id=mfa.get("session_id"),
                        options=mfa.get("options"),
                    )
                logger.error(f"GraphQL errors: {graphql_errors}")
                raise ProviderException(f"GraphQL error: {graphql_errors}")

            receipts_data = data.get("data", {}).get("receiptsWithCounts", {})
            raw_receipts = receipts_data.get("receipts", [])
            all_count = len(raw_receipts)
            raw_receipts = [
                r
                for r in raw_receipts
                if not is_non_grocery_costco_receipt_type(str(r.get("receiptType") or ""))
            ]
            logger.info(
                "Found %s total receipts via API, %s grocery after filtering out gas/carwash",
                all_count,
                len(raw_receipts),
            )

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
