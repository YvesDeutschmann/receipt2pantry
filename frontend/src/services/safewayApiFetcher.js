/**
 * Safeway instore API — app-layer fetch (main Capacitor WebView, CapacitorHttp).
 * Uses CapacitorHttp.request() on native so origin/referer are not stripped (fetch() interceptor removes them).
 * Mirrors logic previously in safewayExtractScript.js IIFE.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const INSTORE_URL = 'https://www.safeway.com/order-account/api/instore';

const DEFAULT_HEADERS = {
  'content-type': 'text/plain;charset=UTF-8',
  accept: '*/*',
  origin: 'https://www.safeway.com',
  referer: 'https://www.safeway.com/order-account/orders',
  'user-agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

const CONCURRENCY = 8;

function isNonFoodItem(name, category) {
  const n = (name || '').toUpperCase();
  const c = (category || '').toUpperCase();
  const NON_FOOD = ['GASOLINE', 'UNLEADED', 'DIESEL', 'FUEL', 'CAR WASH', 'CARWASH'];
  for (let i = 0; i < NON_FOOD.length; i++) {
    if (n.indexOf(NON_FOOD[i]) >= 0) return true;
  }
  return /fuel|gas|automotive/i.test(c);
}

function isFoodReceipt(receipt) {
  const items = receipt.items || receipt.lineItems || [];
  if (!items.length) return true;
  return !items.every((item) =>
    isNonFoodItem(item.name || item.description || '', item.category || '')
  );
}

function parseReceiptList(data) {
  if (!data || typeof data !== 'object') return [];
  let list = data.receipts || data.purchaseHistory || data.orders;
  if (!list && data.data && typeof data.data === 'object') {
    list = data.data.receipts || data.data.purchaseHistory || data.data.orders;
  }
  return Array.isArray(list) ? list : [];
}

function dispatchProgress(step, current = 0, total = 0) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('webview-progress', { detail: { step, current, total } })
  );
}

/**
 * POST to Safeway instore API. Uses native HTTP when CapacitorHttp is enabled.
 * @param {object} payload - { params, token, banner }
 * @param {{ cookieHeader?: string }} [opts]
 */
function normalizeHttpData(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export async function fetchInstore(payload, opts = {}) {
  const headers = { ...DEFAULT_HEADERS };
  if (opts.cookieHeader) {
    headers.Cookie = opts.cookieHeader;
  }
  const body = JSON.stringify(payload);

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      method: 'POST',
      url: INSTORE_URL,
      headers,
      data: body,
    });
    return { status: response.status, data: normalizeHttpData(response.data) };
  }

  const res = await fetch(INSTORE_URL, {
    method: 'POST',
    headers,
    body,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

/**
 * Fetch receipt list + details, filter by date/known IDs, exclude non-food-only receipts.
 *
 * @param {object} params
 * @param {string} params.accessToken
 * @param {string} params.clubCard
 * @param {string[]} [params.knownOrderIds]
 * @param {number} [params.daysOverride=7]
 * @param {string} [params.cookieHeader] - optional full Cookie header if API requires session cookies
 * @returns {Promise<object[]>} Raw receipt objects for parseSafewayReceipt()
 */
export async function fetchSafewayReceipts({
  accessToken,
  clubCard,
  knownOrderIds = [],
  daysOverride = 7,
  cookieHeader,
} = {}) {
  if (!accessToken || accessToken.length < 10) {
    throw new Error('Safeway access token missing');
  }
  if (!clubCard) {
    throw new Error('Safeway club card not found. Please sign in again.');
  }

  const opts = cookieHeader ? { cookieHeader } : {};

  const listPayload = {
    params: { clubcard: clubCard, 'client-section': 'purchase' },
    token: accessToken,
    banner: 'safeway',
  };

  let { status, data } = await fetchInstore(listPayload, opts);
  let list = parseReceiptList(data);

  if (status !== 200 || !list.length) {
    const fb = { params: { clubcard: clubCard }, token: accessToken, banner: 'safeway' };
    const r2 = await fetchInstore(fb, opts);
    status = r2.status;
    data = r2.data;
    list = parseReceiptList(data);
  }

  if (status !== 200) {
    const err = new Error(`Safeway list API failed (${status})`);
    err.status = status;
    throw err;
  }

  const knownSet = new Set((knownOrderIds || []).map(String));
  const cutoff = Date.now() - daysOverride * 24 * 60 * 60 * 1000;

  const filtered = list.filter((r) => {
    // Check every possible ID field — the summary may only carry _id while the stored
    // order_id was written from transactionId (or vice versa). Any hit is a duplicate.
    const candidateIds = [r.transactionId, r._id, r.id].filter(Boolean).map(String);
    if (knownSet.size && candidateIds.some((id) => knownSet.has(id))) return false;
    const dt = r.posDateTime || r.date || '';
    if (dt) {
      try {
        const t = new Date(dt).getTime();
        if (t < cutoff) return false;
      } catch {
        /* keep */
      }
    }
    return true;
  });

  dispatchProgress('list_fetched', 0, filtered.length);
  dispatchProgress('list_filtered', filtered.length, list.length);

  if (!filtered.length) {
    dispatchProgress('done', 0, 0);
    return [];
  }

  const total = filtered.length;
  const results = [];
  let idx = 0;
  let inFlight = 0;
  let completed = 0;

  return new Promise((resolve) => {
    const maybeDone = () => {
      if (completed === total) {
        const foodResults = results.filter(isFoodReceipt);
        dispatchProgress('done', total, total);
        resolve(foodResults);
      }
    };

    const launchNext = () => {
      while (inFlight < CONCURRENCY && idx < filtered.length) {
        const summary = filtered[idx++];
        const receiptId = summary.transactionId || summary._id || summary.id || '';
        if (!receiptId) {
          results.push(summary);
          completed++;
          dispatchProgress('detail_batch', completed, total);
          maybeDone();
          continue;
        }
        inFlight++;
        const detailPayload = {
          params: { clubcard: clubCard, id: receiptId },
          token: accessToken,
          banner: 'safeway',
        };
        fetchInstore(detailPayload, opts)
          .then(({ status: st, data: detail }) => {
            inFlight--;
            if (st !== 200 || !detail || typeof detail !== 'object') {
              results.push(summary);
            } else {
              results.push({ ...summary, ...detail });
            }
            completed++;
            dispatchProgress('detail_batch', completed, total);
            maybeDone();
            launchNext();
          })
          .catch(() => {
            inFlight--;
            results.push(summary);
            completed++;
            dispatchProgress('detail_batch', completed, total);
            maybeDone();
            launchNext();
          });
      }
    };

    launchNext();
  });
}
