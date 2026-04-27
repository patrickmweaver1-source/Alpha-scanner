// Netlify Function: Tradier API proxy
//
// Why this exists: Tradier's sandbox API doesn't allow browser CORS, so the
// scanner can't call it directly. This function runs server-side, accepts
// the user's Tradier token via the X-Tradier-Token header, forwards the
// request to sandbox.tradier.com, and returns the response with permissive
// CORS headers so the static HTML scanner can consume it.
//
// Endpoints proxied (Phase 1):
//   - markets/quotes?symbols=AAPL,MSFT,...
//   - markets/options/expirations?symbol=AAPL&includeAllRoots=true
//   - markets/options/chains?symbol=AAPL&expiration=YYYY-MM-DD&greeks=true
//   - markets/calendar?month=N&year=YYYY
//   - markets/clock
//
// Security notes: The user's Tradier sandbox token is stored client-side in
// localStorage and sent in a header per-request. Sandbox tokens are paper-only
// and have no real money exposure, so the threat model is acceptable.
// The function also accepts process.env.TRADIER_TOKEN as a fallback for
// environments where the user prefers to set it via Netlify env vars.

const TRADIER_BASE = 'https://sandbox.tradier.com/v1/';

// Whitelist of paths we allow proxying. Trade/account endpoints are blocked
// because the scanner is read-only by design.
const ALLOWED_PATH_PREFIXES = [
  'markets/quotes',
  'markets/options/expirations',
  'markets/options/chains',
  'markets/options/strikes',
  'markets/options/lookup',
  'markets/calendar',
  'markets/clock',
  'markets/history',
  'markets/lookup',
  'markets/search',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Tradier-Token, Authorization',
  'Access-Control-Max-Age': '86400',
};

exports.handler = async function (event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'method not allowed' }),
    };
  }

  const params = event.queryStringParameters || {};
  const path = params.path;
  if (!path || typeof path !== 'string') {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'missing required query param: path' }),
    };
  }
  // Path-traversal sanity check + whitelist enforcement
  if (path.indexOf('..') >= 0 || !ALLOWED_PATH_PREFIXES.some(p => path === p || path.startsWith(p + '?') || path.startsWith(p))) {
    return {
      statusCode: 403,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'path not allowed', path }),
    };
  }

  const token =
    event.headers['x-tradier-token'] ||
    event.headers['X-Tradier-Token'] ||
    process.env.TRADIER_TOKEN ||
    '';
  if (!token) {
    return {
      statusCode: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'missing Tradier token. Send X-Tradier-Token header or set TRADIER_TOKEN env var.',
      }),
    };
  }

  // Build forwarded URL. Pass through every query param except `path` itself.
  const url = new URL(path, TRADIER_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (k === 'path') continue;
    if (Array.isArray(v)) v.forEach(vv => url.searchParams.append(k, vv));
    else if (v != null) url.searchParams.set(k, String(v));
  }

  // Hard timeout for upstream call. Tradier markets endpoints normally
  // respond in <2s; 25s is a generous ceiling that fits inside Netlify's
  // 26s function timeout.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const body = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
      },
      body,
    };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err && err.name === 'AbortError';
    return {
      statusCode: 504,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: isAbort ? 'upstream timeout (25s)' : 'upstream fetch failed',
        detail: String(err && err.message ? err.message : err),
      }),
    };
  }
};
