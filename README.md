# TradingView â†’ cTrader Bridge

A self-hosted bridge that connects **TradingView webhook alerts** to **cTrader** for automated trade execution via the cTrader Open API.

## Architecture

```
TradingView Alert
    â†“ HTTP POST (JSON)
Your Bridge (Railway / VPS)
    â†“ WebSocket (JSON)
cTrader Open API (live.ctraderapi.com:5036)
    â†“
Your cTrader Account
```

## Prerequisites

1. **cTrader account** (demo or live)
2. **Open API application** â€” register at https://openapi.ctrader.com/apps (get `CLIENT_ID` and `CLIENT_SECRET`)
3. **OAuth tokens** â€” `ACCESS_TOKEN` and `REFRESH_TOKEN` for your cTrader account
4. **Node.js 20+** for local development

## Setup

### 1. Get OAuth tokens

Install the token fetcher and run:

```bash
npx ctrader-oauth-fetcher --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

This opens a browser; authorize your app. Copy the returned `accessToken` and `refreshToken`.

Alternatively, manually build the OAuth URL:

```
https://openapi.ctrader.com/apps/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:8080&response_type=code&scope=trading
```

Then exchange the code for tokens via:

```
curl -X POST https://openapi.ctrader.com/apps/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"authorization_code","code":"CODE","redirect_uri":"http://localhost:8080","client_id":"YOUR_CLIENT_ID","client_secret":"YOUR_CLIENT_SECRET"}'
```

### 2. Copy and configure env

```bash
cp .env.example .env
```

Fill in all values in `.env`:

| Variable | Description |
|---|---|
| `CLIENT_ID` | From your Open API app |
| `CLIENT_SECRET` | From your Open API app |
| `ACCESS_TOKEN` | OAuth access token |
| `REFRESH_TOKEN` | OAuth refresh token |
| `CTID_TRADER_ACCOUNT_ID` | Your cTrader account ID (numeric) |
| `CTRADER_HOST` | `demo.ctraderapi.com` or `live.ctraderapi.com` |
| `PORT` | HTTP server port (default 3000) |
| `WEBHOOK_SECRET` | Shared secret to authenticate incoming webhooks |

### 3. Install and run locally

```bash
npm install
npm run dev
```

### 4. Configure TradingView alert

When creating an alert in TradingView:

1. Set **Webhook URL** to `https://your-app.railway.app/webhook` (or `http://your-vps:3000/webhook`)
2. Set **Webhook secret** in the alert's Settings â†’ Notifications â†’ Add custom header: `Authorization: Bearer YOUR_WEBHOOK_SECRET`
3. Set **Message** to a JSON payload matching the format below

#### Alert message format (JSON in the alert body)

```json
{
  "action": "BUY",
  "symbol": "EURUSD",
  "volume": 100,
  "orderType": "MARKET",
  "stopLoss": 1.0850,
  "takeProfit": 1.0950,
  "comment": "tv-signal"
}
```

| Field | Required | Description |
|---|---|---|
| `action` | yes | `BUY`, `SELL`, or `CLOSE` |
| `symbol` | if no `symbolId` | Symbol name like `EURUSD`, `XAUUSD` |
| `symbolId` | if no `symbol` | Direct cTrader symbol ID (numeric) |
| `volume` | no | Volume in cents (100 = 0.01 lot). Default 100 |
| `orderType` | no | `MARKET` (default), `LIMIT`, `STOP` |
| `price` | for LIMIT | Limit price |
| `stopLoss` | no | Absolute stop loss price |
| `takeProfit` | no | Absolute take profit price |
| `comment` | no | Order comment |

## Deployment on Railway

1. Push this repo to GitHub
2. Create a new project on [Railway](https://railway.app)
3. Connect your GitHub repo
4. Set all env vars from `.env` in Railway dashboard
5. Railway detects `npm start` automatically
6. Your bridge is live at `https://your-app.railway.app`

## Deployment on Vercel

**Note:** Vercel serverless functions have a 10s timeout and don't maintain persistent WebSocket connections. This bridge is better suited for **Railway**, **Fly.io**, or a **VPS** (which support long-running processes).

## API Endpoints

### `POST /webhook`

Receives TradingView alerts. Requires `Authorization: Bearer <WEBHOOK_SECRET>` header.

### `GET /health`

Returns connection status: `{"status": "connected", "authenticated": true}`

## Important Notes

- The cTrader Open API uses **WebSocket** (port 5036) with JSON messages
- The bridge auto-reconnects on disconnect and refreshes expired OAuth tokens
- Orders are placed asynchronously; check execution via the cTrader platform UI
- Always test on a **demo account** before going live
- Volume is in **cents**: 100 = 0.01 standard lot, 10000 = 1 standard lot
