"""Receipt processor service for orchestrating parse -> normalize -> pantry workflow"""

from typing import Dict, List
from backend.services.supabase_service import SupabaseService
from backend.services.normalization_service import NormalizationService
from backend.services.pantry_service import PantryService
from backend.utils.exceptions import DatabaseException
from backend.utils.logger import get_logger

logger = get_logger(__name__)


class ReceiptProcessor:
    """Service for processing receipts through the full workflow"""
    
    def __init__(
        self,
        supabase: SupabaseService,
        normalizer: NormalizationService,
        pantry: PantryService
    ):
        """
        Initialize ReceiptProcessor
        
        Args:
            supabase: Supabase service instance
            normalizer: NormalizationService instance
            pantry: PantryService instance
        """
        self.supabase = supabase
        self.normalizer = normalizer
        self.pantry = pantry
    
    async def process_receipt(
        self,
        receipt_id: str,
        user_id: str,
        use_ai: bool = True,
        household_id: str = None
    ) -> Dict:
        """
        Process receipt through full workflow: parse -> normalize -> add to pantry
        
        Uses batch normalization for efficiency when AI is enabled.
        
        Args:
            receipt_id: Receipt ID
            user_id: User ID
            use_ai: Whether to use AI for normalization (default True)
            household_id: Household ID for shared pantry (optional, looked up if not provided)
        
        Returns:
            Dictionary with processing results
        """
        try:
            logger.info(f"Starting receipt processing for receipt {receipt_id}")
            
            # Get household_id if not provided
            if not household_id:
                household = self.supabase.get_user_household(user_id)
                household_id = household["id"] if household else None
            
            # 1. Get receipt items
            items = self.supabase.get_receipt_items(receipt_id)

            if not items:
                logger.warning(f"No items found for receipt {receipt_id}")
                return {
                    'receipt_id': receipt_id,
                    'status': 'no_items',
                    'items_processed': 0,
                    'items_added_to_pantry': 0,
                    'errors': [],
                    'ai_used': False
                }
            
            logger.info(f"Found {len(items)} items in receipt")
            
            # 2. Prepare items for batch normalization
            products_to_normalize = []
            valid_items = []
            
            for item in items:
                raw_name = item.get('raw_name') or item.get('name')
                category = item.get('category', '')
                
                if not raw_name:
                    logger.warning(f"Skipping item with no name: {item}")
                    continue
                
                products_to_normalize.append({
                    'raw_name': raw_name,
                    'category': category
                })
                valid_items.append(item)
            
            # 3. Batch normalize all products at once
            normalized_results = self.normalizer.normalize_products_batch(
                products_to_normalize,
                use_ai=use_ai
            )

            if len(normalized_results) != len(valid_items):
                raise ValueError(
                    f"Normalizer returned {len(normalized_results)} results for "
                    f"{len(valid_items)} items — length parity contract violated"
                )

            # 4. Add normalized items to pantry
            items_processed = 0
            items_added = 0
            errors = []
            normalized_items = []
            
            for item, normalized in zip(valid_items, normalized_results):
                try:
                    raw_name = item.get('raw_name') or item.get('name')
                    if normalized is None:
                        logger.info(f"Skipping non-normalizable item '{raw_name}'")
                        items_processed += 1
                        continue
                    normalized_items.append({
                        'raw_name': raw_name,
                        'normalized': normalized
                    })
                    # Extract quantity info (prefer from item, fallback to normalized)
                    quantity_info = item.get('quantity_info') or normalized.get('quantity_info')
                    
                    # Determine quantity and unit for pantry
                    if quantity_info and quantity_info.get('amount') and quantity_info.get('unit'):
                        quantity = quantity_info['amount']
                        unit = quantity_info['unit']
                    else:
                        # Fallback to purchase quantity
                        quantity = item.get('quantity', 1)
                        unit = 'count'
                    
                    # Add to pantry (household-scoped if available)
                    await self.pantry.add_to_pantry(
                        user_id=user_id,
                        normalized_item=normalized,
                        quantity=quantity,
                        unit=unit,
                        receipt_id=receipt_id,
                        household_id=household_id
                    )
                    
                    items_processed += 1
                    items_added += 1
                    
                except Exception as e:
                    raw_name = item.get('raw_name') or item.get('name', 'unknown')
                    error_msg = f"Failed to process item '{raw_name}': {str(e)}"
                    logger.error(error_msg)
                    errors.append(error_msg)
                    items_processed += 1
            
            # 5. Determine status (no DB update — status/processed_at columns don't exist)
            if errors:
                status = 'processed_with_errors'
            else:
                status = 'processed'

            # Check if AI was actually used
            ai_used = any(
                n.get('source') == 'openai'
                for n in normalized_results
                if n
            )
            
            result = {
                'receipt_id': receipt_id,
                'household_id': household_id,
                'status': status,
                'total_items': len(items),
                'items_processed': items_processed,
                'items_added_to_pantry': items_added,
                'normalized_items': normalized_items,
                'errors': errors,
                'ai_used': ai_used
            }
            
            logger.info(
                f"Completed receipt processing for {receipt_id}: "
                f"{items_added}/{len(items)} items added to pantry"
                f"{' (with AI)' if ai_used else ''}"
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to process receipt {receipt_id}: {e}")
            raise DatabaseException(f"Receipt processing failed: {e}")
    
    async def process_multiple_receipts(self, receipt_ids: List[str], user_id: str) -> Dict:
        """
        Process multiple receipts in batch
        
        Args:
            receipt_ids: List of receipt IDs
            user_id: User ID
        
        Returns:
            Dictionary with batch processing results
        """
        results = []
        total_items_added = 0
        total_errors = 0
        
        for receipt_id in receipt_ids:
            try:
                result = await self.process_receipt(receipt_id, user_id)
                results.append(result)
                total_items_added += result.get('items_added_to_pantry', 0)
                total_errors += len(result.get('errors', []))
            except Exception as e:
                logger.error(f"Failed to process receipt {receipt_id}: {e}")
                results.append({
                    'receipt_id': receipt_id,
                    'status': 'failed',
                    'error': str(e)
                })
                total_errors += 1
        
        return {
            'total_receipts': len(receipt_ids),
            'successful': sum(1 for r in results if r.get('status') in ['processed', 'processed_with_errors']),
            'failed': sum(1 for r in results if r.get('status') == 'failed'),
            'total_items_added': total_items_added,
            'total_errors': total_errors,
            'results': results
        }
    
    def get_processing_status(self, receipt_id: str) -> Dict:
        """
        Get processing status for a receipt
        
        Args:
            receipt_id: Receipt ID
        
        Returns:
            Dictionary with status information
        """
        try:
            # Get receipt (use admin_client to bypass RLS when called from backend)
            client = self.supabase.admin_client if self.supabase.admin_client else self.supabase.client
            response = client.table("receipts").select("*").eq("id", receipt_id).execute()
            
            if not response.data or len(response.data) == 0:
                return {
                    'receipt_id': receipt_id,
                    'status': 'not_found'
                }
            
            receipt = response.data[0]
            
            # Get items count
            items = self.supabase.get_receipt_items(receipt_id)
            
            return {
                'receipt_id': receipt_id,
                'status': receipt.get('status', 'unknown'),
                'total_items': len(items),
                'processed_at': receipt.get('processed_at'),
                'fetched_at': receipt.get('fetched_at'),
                'order_date': receipt.get('order_date'),
                'provider': receipt.get('provider')
            }
            
        except Exception as e:
            logger.error(f"Failed to get processing status for receipt {receipt_id}: {e}")
            raise DatabaseException(f"Failed to get processing status: {e}")


def create_receipt_processor(
    supabase: SupabaseService,
    normalizer: NormalizationService,
    pantry: PantryService
) -> ReceiptProcessor:
    """
    Factory function to create ReceiptProcessor
    
    Args:
        supabase: Supabase service instance
        normalizer: NormalizationService instance
        pantry: PantryService instance
    
    Returns:
        Initialized ReceiptProcessor instance
    """
    return ReceiptProcessor(supabase, normalizer, pantry)


