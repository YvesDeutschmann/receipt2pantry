"""Receipt service for orchestrating provider and parser operations"""

from typing import Dict, List, Optional
from datetime import datetime
from backend.utils.logger import get_logger
from backend.utils.exceptions import ProviderException, ParserException

logger = get_logger(__name__)


def fetch_and_parse_receipts(
    user_id: str,
    provider_name: str,
    provider_instance,
    parser_instance,
    supabase_service,
    since: datetime,
    credentials: Dict,
) -> Dict:
    """
    Orchestrate fetching and parsing receipts from a provider
    
    Args:
        user_id: User ID
        provider_name: Provider name
        provider_instance: Provider instance (implementing BaseProvider)
        parser_instance: Parser instance (implementing BaseParser)
        supabase_service: Supabase service for database operations
        since: Fetch receipts from this date onwards
        credentials: Provider credentials
    
    Returns:
        Dictionary with status and results
    """
    logger.info(f"Starting receipt fetch for user {user_id}, provider {provider_name}")
    
    result = {
        "status": "success",
        "receipts_fetched": 0,
        "receipts_stored": 0,
        "skipped_duplicates": 0,
        "errors": [],
    }
    
    try:
        # Step 1: Login to provider
        logger.info(f"Logging in to {provider_name}")
        login_success = provider_instance.login(credentials)
        
        if not login_success:
            result["status"] = "failure"
            result["errors"].append("Login failed")
            return result
        
        # Step 2: Fetch receipts
        logger.info(f"Fetching receipts from {provider_name}")
        raw_receipts = provider_instance.fetch_receipts(since)
        result["receipts_fetched"] = len(raw_receipts)
        
        # Step 3: Parse and store each receipt
        for raw_receipt in raw_receipts:
            try:
                # Check if data is already structured (from web scraping)
                # vs raw email content that needs parsing
                if raw_receipt.get("items") and isinstance(raw_receipt["items"], list):
                    # Data is already structured from web scraping
                    logger.info(f"Using pre-structured data for receipt {raw_receipt.get('order_id')}")
                    parsed_data = raw_receipt
                    
                    # Validate the pre-structured data has required fields
                    required_fields = ["order_id", "order_date", "items"]
                    missing_fields = [f for f in required_fields if f not in parsed_data]
                    if missing_fields:
                        logger.warning(f"Pre-structured data missing fields: {missing_fields}")
                        result["errors"].append(
                            f"Missing fields for receipt: {missing_fields}"
                        )
                        continue
                else:
                    # Legacy: Parse from raw email content
                    raw_data = raw_receipt.get("raw_data", "")
                    if not raw_data:
                        logger.warning(f"No raw_data or items in receipt, skipping")
                        result["errors"].append("Receipt has no data to parse")
                        continue
                    
                    parsed_data = parser_instance.parse(raw_data)
                    
                    # Validate parsed data
                    if not parser_instance.validate(parsed_data):
                        logger.warning(f"Invalid receipt data: {parsed_data.get('order_id')}")
                        result["errors"].append(
                            f"Invalid data for receipt {parsed_data.get('order_id')}"
                        )
                        continue
                
                # Store receipt
                receipt_id = store_parsed_receipt(
                    user_id, provider_name, parsed_data, supabase_service
                )
                if receipt_id is not None:
                    result["receipts_stored"] += 1
                    logger.info(f"Stored receipt {receipt_id}")
                else:
                    result["skipped_duplicates"] += 1
                    logger.info(
                        f"Skipped duplicate receipt (order_id={parsed_data.get('order_id')})"
                    )
                
            except ParserException as e:
                logger.error(f"Parser error: {e}")
                result["errors"].append(f"Parser error: {str(e)}")
            except Exception as e:
                logger.error(f"Unexpected error storing receipt: {e}")
                result["errors"].append(f"Storage error: {str(e)}")
        
        # Cleanup provider resources
        provider_instance.cleanup()
        
        if result["errors"]:
            result["status"] = "partial"
        
        logger.info(
            f"Receipt fetch complete: {result['receipts_stored']}/{result['receipts_fetched']} stored"
        )
        return result
    
    except ProviderException as e:
        logger.error(f"Provider error: {e}")
        result["status"] = "failure"
        result["errors"].append(str(e))
        return result
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        result["status"] = "failure"
        result["errors"].append(str(e))
        return result


def parse_receipt_from_email(email_content: str, parser_instance) -> Dict:
    """
    Parse a receipt from email content
    
    Args:
        email_content: Raw email content
        parser_instance: Parser instance
    
    Returns:
        Parsed receipt dictionary
    """
    logger.info("Parsing receipt from email")
    
    try:
        parsed_data = parser_instance.parse(email_content)
        
        if not parser_instance.validate(parsed_data):
            raise ParserException("Parsed data validation failed")
        
        logger.info(f"Successfully parsed receipt {parsed_data.get('order_id')}")
        return parsed_data
    
    except Exception as e:
        logger.error(f"Failed to parse receipt: {e}")
        raise ParserException(f"Failed to parse receipt: {e}")


def store_parsed_receipt(
    user_id: str,
    provider: str,
    receipt_data: Dict,
    supabase_service,
    grocery_account_id: str = None,
    household_id: str = None,
) -> Optional[str]:
    """
    Store a parsed receipt in the database
    
    Args:
        user_id: User ID
        provider: Provider name
        receipt_data: Parsed receipt data
        supabase_service: Supabase service instance
        grocery_account_id: Optional grocery account ID
        household_id: Optional household ID for shared access
    
    Returns:
        Receipt ID, or None if the receipt already exists (idempotent duplicate)
    """
    logger.info(f"Storing receipt {receipt_data.get('order_id')} for user {user_id}")
    
    try:
        # Get household_id if not provided
        if not household_id:
            household = supabase_service.get_user_household(user_id)
            household_id = household["id"] if household else None
        
        # Prepare receipt record and items for a single transaction
        receipt_record = {
            "user_id": user_id,
            "household_id": household_id,
            "grocery_account_id": grocery_account_id,
            "provider": provider,
            "order_id": receipt_data["order_id"],
            "order_date": receipt_data["order_date"],
            "total_amount": receipt_data["total_amount"],
            "num_items": receipt_data.get("num_items", len(receipt_data["items"])),
            "raw_data": receipt_data,
            "fetched_at": datetime.utcnow().isoformat(),
            "created_at": datetime.utcnow().isoformat(),
        }
        items = []
        for item in receipt_data["items"]:
            item_record = {
                "user_id": user_id,
                "name": item["name"],
                "category": item.get("category", "UNKNOWN"),
                "price": item["price"],
                "quantity": item["quantity"],
                "quantity_info": {
                    "amount": item["quantity"],
                    "unit": item.get("unit", "count"),
                },
                "regular_price": item.get("regular_price"),
                "savings": item.get("savings"),
                "created_at": datetime.utcnow().isoformat(),
            }
            items.append(item_record)
        
        # Single transaction: receipt + items; None when duplicate (user_id, provider, order_id)
        receipt_id = supabase_service.store_receipt_with_items(receipt_record, items)
        if receipt_id is not None:
            logger.info(f"Successfully stored receipt {receipt_id} with {len(items)} items")
        return receipt_id
    
    except Exception as e:
        logger.error(f"Failed to store receipt: {e}")
        raise


def store_fetched_receipts(
    user_id: str,
    provider_name: str,
    receipts: List[Dict],
    supabase_service,
) -> Dict:
    """
    Store provider-fetched receipts in the database.
    Caller should then process each stored receipt (normalize and add to pantry)
    via ReceiptProcessor.process_receipt().

    Args:
        user_id: User ID
        provider_name: Provider name (e.g. 'safeway')
        receipts: List of receipt dicts with order_id, order_date, total_amount, items
        supabase_service: Supabase service instance

    Returns:
        Dict with receipt_ids (list of stored receipt IDs), receipts_stored (count),
        skipped_duplicates (count of already-imported receipts), and
        errors (list of error messages for receipts that failed to store)
    """
    result = {"receipt_ids": [], "receipts_stored": 0, "skipped_duplicates": 0, "errors": []}
    required_fields = ["order_id", "order_date", "items"]
    for raw_receipt in receipts:
        try:
            missing = [f for f in required_fields if f not in raw_receipt]
            if missing:
                result["errors"].append(f"Receipt missing fields: {missing}")
                continue
            if not isinstance(raw_receipt.get("items"), list):
                result["errors"].append(f"Receipt {raw_receipt.get('order_id')} has no items list")
                continue
            # Ensure total_amount for store_parsed_receipt
            parsed_data = dict(raw_receipt)
            if "total_amount" not in parsed_data and "total" in parsed_data:
                parsed_data["total_amount"] = parsed_data["total"]
            elif "total_amount" not in parsed_data:
                parsed_data["total_amount"] = 0.0
            
            receipt_id = store_parsed_receipt(
                user_id, provider_name, parsed_data, supabase_service
            )
            if receipt_id is not None:
                result["receipt_ids"].append(receipt_id)
                result["receipts_stored"] += 1
                logger.info(
                    f"Stored new receipt {receipt_id} (order_id={parsed_data.get('order_id')})"
                )
            else:
                result["skipped_duplicates"] += 1

        except Exception as e:
            logger.warning(f"Failed to store receipt {raw_receipt.get('order_id', '?')}: {e}")
            result["errors"].append(f"Store error: {str(e)}")
    return result

