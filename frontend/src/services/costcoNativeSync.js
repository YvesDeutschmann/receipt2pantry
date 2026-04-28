/**
 * Costco Native Sync - Receipt parsing and backend submission for One-Tap Sync.
 * Receipts are fetched in-WebView; this module parses and submits them.
 */

import { api } from './apiClient'

export { decodeJwtPayload, isTokenExpired } from './jwtUtils'

/**
 * Parse raw Costco API receipt to standard format. Exported for use by costcoWebViewBridge.
 */
export function parseApiReceipt(raw) {
  try {
    const transDateStr = raw.transactionDateTime || '';
    let transDate;
    try {
      transDate = new Date(transDateStr.replace('Z', '+00:00'));
      if (isNaN(transDate.getTime())) transDate = new Date();
    } catch {
      transDate = new Date();
    }

    const items = (raw.itemArray || []).map((item) => {
      const desc1 = item.itemDescription01 || '';
      const desc2 = item.itemDescription02 || '';
      const name = `${desc1} ${desc2}`.trim() || 'Unknown Item';
      return {
        name,
        quantity: parseFloat(item.unit) || 1,
        unit_price: 0,
        price: parseFloat(item.amount) || 0,
        item_number: item.itemNumber || '',
        category: 'GROCERY',
      };
    });

    const total = parseFloat(raw.total) || 0;
    let orderId = (raw.transactionBarcode || '').trim();
    if (!orderId) {
      const fallback = JSON.stringify(raw);
      let hash = 0;
      for (let i = 0; i < fallback.length; i++) {
        hash = (hash << 5) - hash + fallback.charCodeAt(i);
        hash |= 0;
      }
      orderId = `COSTCO_${Math.abs(hash).toString(16).slice(0, 12)}`;
    }

    return {
      store_name: raw.warehouseName || 'Costco',
      store_location: raw.warehouseName || '',
      order_id: orderId,
      order_date: transDate.toISOString().slice(0, 10),
      total_amount: total,
      date: transDate.toISOString().slice(0, 10),
      time: transDate.toTimeString().slice(0, 8),
      total,
      items,
      transaction_id: orderId,
      receipt_type: raw.receiptType || 'warehouse',
      document_type: raw.documentType || '',
      raw_data: raw,
    };
  } catch {
    return null;
  }
}

/**
 * Submit fetched receipts to app backend for storage and pantry processing.
 */
export async function submitToBackend(receipts, userId) {
  return api.storeCostcoReceipts(receipts, userId);
}
