import { Router, Request, Response } from 'express';
import { CTraderClient } from './ctrader-client.js';
import { TradingViewAlert, OrderType, TradeSide } from './types.js';

export function createWebhookRouter(client: CTraderClient, webhookSecret: string): Router {
  const router = Router();

  router.post('/webhook', async (req: Request, res: Response) => {
    // Auth check
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

    const alert = req.body as TradingViewAlert;
    if (!alert || !alert.action) {
      res.status(400).json({ error: 'Missing action in alert payload' });
      return;
    }

    try {
      switch (alert.action.toUpperCase()) {
        case 'BUY':
        case 'SELL': {
          const tradeSide = alert.action.toUpperCase() === 'BUY' ? TradeSide.BUY : TradeSide.SELL;

          // Resolve symbol name to symbolId
          let symbolId = alert.symbolId;
          if (!symbolId && alert.symbol) {
            const resolved = await client.getSymbolId(alert.symbol);
            if (!resolved) {
              res.status(400).json({ error: `Unknown symbol: ${alert.symbol}` });
              return;
            }
            symbolId = resolved;
          }
          if (!symbolId) {
            res.status(400).json({ error: 'Missing symbolId or symbol' });
            return;
          }

          const orderTypeMap: Record<string, number> = {
            MARKET: OrderType.MARKET,
            LIMIT: OrderType.LIMIT,
            STOP: OrderType.STOP,
          };

          const orderType = alert.orderType
            ? (orderTypeMap[alert.orderType.toUpperCase()] ?? OrderType.MARKET)
            : OrderType.MARKET;

          await client.placeOrder({
            symbolId,
            tradeSide,
            volume: alert.volume ?? 100, // default 0.01 lot (100 cents)
            orderType,
            price: alert.price,
            stopPrice: alert.price,
            stopLoss: alert.stopLoss,
            takeProfit: alert.takeProfit,
            comment: alert.comment,
          });

          res.json({ status: 'order_submitted', action: alert.action, symbolId });
          break;
        }

        case 'CLOSE': {
          // Close requests need a positionId - for simplicity, require it in the payload
          if (!alert.symbolId) {
            res.status(400).json({ error: 'CLOSE requires symbolId' });
            return;
          }
          await client.closePosition(alert.symbolId);
          res.json({ status: 'close_submitted' });
          break;
        }

        default:
          res.status(400).json({ error: `Unknown action: ${alert.action}` });
      }
    } catch (err) {
      console.error('Order error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: client.isAuthenticated() ? 'connected' : 'disconnected',
      authenticated: client.isAuthenticated(),
    });
  });

  return router;
}
