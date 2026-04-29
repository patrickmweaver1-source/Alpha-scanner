// Netlify Function: Tradier API proxy
//
// Why this exists: Tradier's sandbox API doesn't allow browser CORS, so the
// scanner can't call it directly. This function runs server-side, accepts
// the user's Tradier token via the X-Tradier-Token header, forwards the
// request to sandbox.tradier.com, and returns the response with permissive
// CORS headers so the static HTML scanner can consume it.

const TRADIER_BASE = 'https://sandbox.tradier.com/v1/';

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

  const url = new URL(path, TRADIER_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (k === 'path') continue;
    if (Array.isArray(v)) v.forEach(vv => url.searchParams.append(k, vv));
    else if (v != null) url.searchParams.set(k, String(v));
  }

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
