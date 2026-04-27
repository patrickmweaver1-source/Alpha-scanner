# Alpha Scanner — Crypto Perpetuals + US Options

A browser-based scanner for high-conviction trading setups across:
- **Crypto perpetuals** on Bybit USDT (CoinGecko-driven universe, AI verdict, structural S/R-anchored stops/targets)
- **US options** (Tradier sandbox-driven, S&P 500 + curated ETFs/popular names, IV-rank screening, Greek-based filtering)

## Project structure

```
alpha-scanner/
├── index.html                  ← The full scanner app (single-page, runs in browser)
├── netlify.toml                ← Netlify build config
├── package.json                ← Declares Node 18+ for the function
└── netlify/
    └── functions/
        └── tradier.js          ← Server-side proxy to Tradier API (CORS bridge)
```

## Initial deploy (one-time setup)

You're switching from drag-and-drop deploy to a project deploy because the
options scanner needs a server-side proxy (Tradier doesn't support browser
CORS). Two options:

### Option A: Netlify CLI (fastest, no git required)

```bash
npm install -g netlify-cli
cd alpha-scanner   # the folder containing this README
netlify login
netlify deploy --prod
# Choose "Create & configure a new site" the first time, or link to your
# existing jovial-bubblegum-fe0d3d site if you want to keep the same URL.
```

### Option B: Git deploy (recommended for ongoing iteration)

1. Put this folder in a Git repo (GitHub/GitLab/Bitbucket).
2. In Netlify dashboard → Add new site → Import existing project → select repo.
3. Netlify auto-detects `netlify.toml`, no extra config needed.
4. Every git push redeploys automatically.

## Tradier setup

1. Open a Tradier brokerage account at https://tradier.com (KYC required).
2. From the web UI, go to your account dropdown → create a paper-trading account.
3. Settings → API → copy your sandbox API token.
4. In the scanner, switch to the **Options** tab → paste the token into the
   "Tradier Sandbox Token" config field. It's stored in your browser's
   localStorage only, never sent anywhere except (encrypted) to the proxy.

## CoinGecko + Anthropic setup (unchanged)

Same as before:
- CoinGecko Demo API key (optional but recommended)
- Anthropic API key for AI Verdict feature

## Architecture notes

- **Crypto half**: 100% browser-side. CoinGecko + Bybit + Anthropic all support browser CORS.
- **Options half**: browser → Netlify Function → Tradier sandbox. The function is a thin pass-through with token forwarding and CORS headers. The user's token is sent via `X-Tradier-Token` header per-request; it never lives on Netlify's side unless you choose to set `TRADIER_TOKEN` as an environment variable.
- **Rate limits**: Tradier sandbox is 60 requests/minute on `/markets` endpoints. The options scanner paces itself accordingly.
- **Data freshness**: Tradier sandbox is 15-min delayed. Fine for a daily scanner; upgrade to Tradier production ($10/mo) for real-time.

## Versions

- **0.1.0** — Phase 1: project structure + Tradier proxy + options scan UI scaffold. No AI verdict or tracker yet.
