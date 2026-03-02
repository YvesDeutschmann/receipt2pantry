/**
 * Costco Native Sync - Receipt parsing and backend submission for One-Tap Sync.
 * Receipts are fetched in-WebView; this module parses and submits them.
 */

function base64UrlDecode(str) {
  let payload = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = payload.length % 4;
  if (pad) payload += '='.repeat(4 - pad);
  try {
    return JSON.parse(atob(payload));
  } catch {
    return {};
  }
}

/**
 * Decode JWT payload without verification
 */
export function decodeJwtPayload(token) {
  if (!token) return {};
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  return base64UrlDecode(parts[1]);
}

/**
 * Check if token is expired or will expire within bufferSeconds
 */
export function isTokenExpired(token, bufferSeconds = 60) {
  const payload = decodeJwtPayload(token);
  const exp = payload.exp;
  if (!exp) return true;
  const expiryTime = exp * 1000;
  return Date.now() >= expiryTime - bufferSeconds * 1000;
}

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

function getApiBase(apiBaseUrl) {
  if (apiBaseUrl) return apiBaseUrl;
  if (import.meta.env?.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  const host = typeof window !== 'undefined' ? window.location?.hostname || 'localhost' : 'localhost';
  return `http://${host}:5000/api`;
}

/**
 * Submit fetched receipts to app backend for storage and pantry processing.
 */
export async function submitToBackend(receipts, userId, apiBaseUrl) {
  const base = getApiBase(apiBaseUrl);
  const url = `${base.replace(/\/$/, '')}/providers/costco/store-receipts`;
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ receipts, user_id: userId }),
  });

  if (response.status === 404) {
    throw new Error(
      'Backend endpoint /providers/costco/store-receipts not found. Add the spike backend route (see spike/README.md).'
    );
  }
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error || `Backend error: ${response.status}`);
  }
  return response.json();
}
