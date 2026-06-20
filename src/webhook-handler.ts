import { Router, Request, Response } from 'express';
import { CTraderClient } from './ctrader-client.js';
import { TradeSide, OrderType } from './types.js';

interface WebhookPayload {
  Action?: string;
  symbol?: string;
  entry?: number;
  sl?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  notional?: number;
  [key: string]: unknown;
}

function parseAction(action: string): { tradeSide: number; orderType: number } | null {
  const upper = action.toUpperCase();

  let tradeSide: number;
  if (upper.includes('LONG') || upper.includes('BUY')) {
    tradeSide = TradeSide.BUY;
  } else if (upper.includes('SHORT') || upper.includes('SELL')) {
    tradeSide = TradeSide.SELL;
  } else {
    return null;
  }

  const orderType = upper.includes('LIMIT') ? OrderType.LIMIT
    : upper.includes('STOP') ? OrderType.STOP
    : OrderType.MARKET;

  return { tradeSide, orderType };
}

export function createWebhookRouter(client: CTraderClient, secret: string): Router {
  const router = Router();

  router.get('/health', function (_req: Request, res: Response) {
    res.json({
      status: client.isAuthenticated() ? 'connected' : 'disconnected',
      authenticated: client.isAuthenticated(),
    });
  });

  router.post('/webhook', async function (req: Request, res: Response) {
    const auth = req.headers.authorization;

    if (!auth || auth !== 'Bearer ' + secret) {
      console.log('Unauthorized webhook request from ' + req.ip);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body as WebhookPayload;
    console.log('Received webhook:', JSON.stringify(body));

    if (!body.Action || !body.symbol || body.entry == null || body.notional == null) {
      res.status(400).json({
        error: 'Missing required fields: Action, symbol, entry, notional',
      });
      return;
    }

    const parsed = parseAction(body.Action);
    if (!parsed) {
      res.status(400).json({
        error: 'Could not parse Action: ' + body.Action + ' (expected "DiMea Long" or similar)',
      });
      return;
    }

    try {
      const symbolId = await client.getSymbolId(body.symbol);
      if (!symbolId) {
        res.status(400).json({ error: 'Unknown symbol: ' + body.symbol });
        return;
      }

      console.log('Symbol ' + body.symbol + ' -> id ' + symbolId);

      const { tradeSide, orderType } = parsed;
      const volume = body.notional;
      const price = orderType === OrderType.MARKET ? undefined : body.entry;
      const stopLoss = body.sl;
      const takeProfit = body.tp1;

      if (body.tp2 || body.tp3) {
        console.log('Note: tp2=' + body.tp2 + ' tp3=' + body.tp3 + ' not applied (cTrader supports only one TP)');
      }

      await client.placeOrder({
        symbolId,
        tradeSide,
        volume,
        orderType,
        price,
        stopLoss,
        takeProfit,
        comment: 'TV bridge',
      });

      console.log('Order placed successfully');
      res.json({ success: true, message: 'Order placed' });
    } catch (err) {
      console.error('Order placement failed:', err);
      res.status(500).json({ error: 'Order placement failed', details: String(err) });
    }
  });

  return router;
}