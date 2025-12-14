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
    
    async def process_receipt(self, receipt_id: str, user_id: str) -> Dict:
        """
        Process receipt through full workflow: parse -> normalize -> add to pantry
        
        Args:
            receipt_id: Receipt ID
            user_id: User ID
        
        Returns:
            Dictionary with processing results
        """
        try:
            logger.info(f"Starting receipt processing for receipt {receipt_id}")
            
            # 1. Get receipt items
            items = self.supabase.get_receipt_items(receipt_id)
            
            if not items:
                logger.warning(f"No items found for receipt {receipt_id}")
                return {
                    'receipt_id': receipt_id,
                    'status': 'no_items',
                    'items_processed': 0,
                    'items_added_to_pantry': 0,
                    'errors': []
                }
            
            logger.info(f"Found {len(items)} items in receipt")
            
            # 2. Normalize and add each item to pantry
            items_processed = 0
            items_added = 0
            errors = []
            normalized_items = []
            
            for item in items:
                try:
                    raw_name = item.get('raw_name') or item.get('name')
                    category = item.get('category', '')
                    
                    if not raw_name:
                        logger.warning(f"Skipping item with no name: {item}")
                        continue
                    
                    # Normalize the product
                    normalized = self.normalizer.normalize_product(raw_name, category)
                    normalized_items.append({
                        'raw_name': raw_name,
                        'normalized': normalized
                    })
                    
                    # Extract quantity info
                    quantity_info = item.get('quantity_info')
                    
                    # Determine quantity and unit for pantry
                    if quantity_info and quantity_info.get('amount') and quantity_info.get('unit'):
                        quantity = quantity_info['amount']
                        unit = quantity_info['unit']
                    else:
                        # Fallback to purchase quantity
                        quantity = item.get('quantity', 1)
                        unit = 'count'
                    
                    # Add to pantry
                    await self.pantry.add_to_pantry(
                        user_id=user_id,
                        normalized_item=normalized,
                        quantity=quantity,
                        unit=unit,
                        receipt_id=receipt_id
                    )
                    
                    items_processed += 1
                    items_added += 1
                    
                except Exception as e:
                    error_msg = f"Failed to process item '{raw_name}': {str(e)}"
                    logger.error(error_msg)
                    errors.append(error_msg)
                    items_processed += 1
            
            # 3. Update receipt status
            if errors:
                status = 'processed_with_errors'
            else:
                status = 'processed'
            
            self.supabase.update_receipt_status(receipt_id, status)
            
            result = {
                'receipt_id': receipt_id,
                'status': status,
                'total_items': len(items),
                'items_processed': items_processed,
                'items_added_to_pantry': items_added,
                'normalized_items': normalized_items,
                'errors': errors
            }
            
            logger.info(
                f"Completed receipt processing for {receipt_id}: "
                f"{items_added}/{len(items)} items added to pantry"
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to process receipt {receipt_id}: {e}")
            
            # Update receipt status to failed
            try:
                self.supabase.update_receipt_status(receipt_id, 'failed')
            except Exception as update_error:
                logger.error(f"Failed to update receipt status: {update_error}")
            
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
            # Get receipt
            response = self.supabase.client.table("receipts").select("*").eq("id", receipt_id).execute()
            
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


