import { Router, Request, Response } from 'express';
import { CTraderClient } from './ctrader-client.js';
import { OrderType, TradeSide } from './types.js';

export function createWebhookRouter(client: CTraderClient, webhookSecret: string): Router {
  const router = Router();

  router.post('/webhook', async (req: Request, res: Response) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== webhookSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!client.isAuthenticated()) {
      res.status(503).json({ error: 'cTrader not connected' });
      return;
    }

    const alert = req.body;
    console.log(Received alert: );
    
    if (!alert || !alert.Action) {
      res.status(400).json({ error: 'Missing Action in alert payload' });
      return;
    }

    try {
      const action = alert.Action as string;
      const isLong = action.toLowerCase().includes('long');
      const isShort = action.toLowerCase().includes('short');

      if (!isLong && !isShort) {
        res.status(400).json({ error: Cannot parse direction from Action:  });
        return;
      }

      const tradeSide = isLong ? TradeSide.BUY : TradeSide.SELL;
      const symbol = alert.symbol as string | undefined;
      const entryPrice = alert.entry as number | undefined;
      const sl = alert.sl as number | undefined;
      const tp1 = alert.tp1 as number | undefined;
      const notional = alert.notional as number | undefined;

      if (!symbol) {
        res.status(400).json({ error: 'Missing symbol' });
        return;
      }

      const symbolId = await client.getSymbolId(symbol);
      if (!symbolId) {
        res.status(400).json({ error: Unknown symbol:  });
        return;
      }

      // notional is in cents - use directly as volume (100 = 0.01 lot)
      const volume = notional ?? 100;

      await client.placeOrder({
        symbolId,
        tradeSide,
        volume,
        orderType: OrderType.MARKET,
        stopLoss: sl,
        takeProfit: tp1,
        comment: action,
      });

      const response: Record<string, unknown> = {
        status: 'order_submitted',
        action,
        symbol,
        volume,
        sl,
        tp1,
      };

      if (alert.tp2 || alert.tp3) {
        response.note = Additional TP levels not set: tp2=, tp3=. Only tp1 was applied.;
      }

      res.json(response);
    } catch (err) {
      console.log(Order error: );
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: client.isAuthenticated() ? 'connected' : 'disconnected',
      authenticated: client.isAuthenticated(),
    });
  });

  return router;
}