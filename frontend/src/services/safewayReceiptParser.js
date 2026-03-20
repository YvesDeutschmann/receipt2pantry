/**
 * Safeway receipt parser - converts raw Safeway instore API response to the format
 * expected by store_fetched_receipts / receipt_service.
 *
 * Mirrors field resolution from backend safeway_provider.py (lines 659-679).
 * Used after app-layer Safeway API fetch (safewayApiFetcher) before ingest.
 * Unit-testable: pass raw API objects to verify parsing.
 */

/**
 * Parse a single item from Safeway API detail response.
 * @param {Object} item - Raw item from API (items/lineItems array element)
 * @returns {Object} { name, price, quantity, unit, category, regular_price, savings }
 */
function parseItem(item) {
  const priceVal =
    item.reducedPriceTotal ??
    item.reducedPrice ??
    item.price ??
    item.extendedPrice ??
    item.amount ??
    item.finalPrice ??
    0;
  const price = typeof priceVal === 'number' ? priceVal : parseFloat(priceVal) || 0;

  const qty = item.quantity ?? item.qty ?? 1;
  const qtyNum =
    typeof qty === 'number' && qty === Math.floor(qty)
      ? Math.floor(qty)
      : parseFloat(qty) || 1;

  return {
    name:
      item.name ?? item.description ?? item.productName ?? 'Unknown',
    price,
    quantity: qtyNum,
    unit: item.weightItem ? 'lb' : 'count',
    category: item.department ?? item.category ?? item.dept ?? 'Grocery',
    regular_price: item.regularPrice ?? item.basePrice,
    savings: item.discount ?? item.savings ?? item.promo,
  };
}

/**
 * Extract items array from detail receipt (handles items, lineItems, receipt.items, etc.)
 */
function getItemList(detail) {
  let list = detail?.items ?? detail?.lineItems ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    const data = detail?.data ?? detail;
    list = data?.items ?? data?.lineItems ?? data?.products ?? [];
  }
  if (!Array.isArray(list) || list.length === 0) {
    const data = detail?.data ?? detail;
    const receipt = detail?.receipt ?? data?.receipt;
    list = receipt?.items ?? receipt?.lineItems ?? [];
  }
  return Array.isArray(list) ? list : [];
}

/**
 * Parse raw Safeway API receipt (detail or summary) to structured format for backend.
 *
 * @param {Object} raw - Raw receipt from API. Can be:
 *   - Detail: { receipts: [{ items, posDateTime, finalTotal, ... }] } or single detail object
 *   - Summary: { _id, posDateTime, finalTotal, transactionId, ... } with optional items
 * @param {Object} [summary] - Optional receipt summary for fallback metadata
 * @returns {Object|null} Structured receipt or null if invalid
 */
export function parseSafewayReceipt(raw, summary = null) {
  if (!raw || typeof raw !== 'object') return null;

  // Handle wrapped format: { receipts: [detail] }
  let detail = raw;
  if (raw.receipts && Array.isArray(raw.receipts) && raw.receipts[0]) {
    detail = raw.receipts[0];
  }
  const fallback = summary ?? raw;

  const itemList = getItemList(detail);
  const items = itemList.map(parseItem);

  const posDt = detail.posDateTime ?? fallback.posDateTime ?? '';
  let receiptDate;
  try {
    receiptDate = posDt ? new Date(posDt.replace('Z', '')) : new Date();
  } catch {
    receiptDate = new Date();
  }
  if (isNaN(receiptDate.getTime())) receiptDate = new Date();

  const orderDateStr = `${receiptDate.getFullYear()}-${String(
    receiptDate.getMonth() + 1
  ).padStart(2, '0')}-${String(receiptDate.getDate()).padStart(2, '0')}`;

  const total =
    parseFloat(detail.finalTotal ?? fallback.finalTotal ?? 0) ||
    parseFloat(detail.total ?? fallback.total ?? 0) ||
    0;

  const numItemsVal = detail.itemCount ?? fallback.itemCount ?? fallback.item_count;
  const numItems =
    numItemsVal != null ? parseInt(numItemsVal, 10) : items.length;
  const numItemsInt = Number.isNaN(numItems) ? items.length : numItems;

  const receiptId = detail._id ?? detail.id ?? fallback._id ?? fallback.id ?? '';
  const orderId =
    detail.transactionId ?? fallback.transactionId ?? receiptId ?? 'unknown';

  return {
    order_id: orderId,
    order_date: orderDateStr,
    total_amount: total,
    num_items: numItemsInt,
    date: receiptDate.toISOString ? receiptDate.toISOString() : String(receiptDate),
    store:
      detail.storeName ?? fallback.storeName ?? fallback.store ?? 'Safeway',
    items,
    source: 'safeway_instore_api',
  };
}
