import WebSocket from 'ws';
import { PayloadType, OrderType, TradeSide, OAMessage } from './types.js';

let msgCounter = 1;
function uid(): string {
  return 'cm_id_' + String(msgCounter++);
}

const HARDCODED_VOLUME_LIMITS: Record<string, { minVolume?: number; maxVolume?: number }> = {
  EURUSD: { minVolume: 1000 },
  GBPUSD: { minVolume: 1000 },
  USDJPY: { minVolume: 1000 },
  USDCHF: { minVolume: 1000 },
  AUDUSD: { minVolume: 1000 },
  USDCAD: { minVolume: 1000 },
  NZDUSD: { minVolume: 1000 },
  BTCUSD: { maxVolume: 5 },
  ETHUSD: { maxVolume: 5 },
};

export interface SymbolInfo {
  symbolId: number;
  symbolName: string;
  minVolume?: number;
  maxVolume?: number;
}

export class CTraderClient {
  private ws: WebSocket | null = null;
  private host: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string;
  private refreshToken: string;
  private accountId: number;
  private authenticated = false;
  private pendingResolve: ((value: boolean | PromiseLike<boolean>) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  private pendingSymbolResolve: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private log: (msg: string) => void;

  onExecutionEvent: ((payload: any) => void) | null = null;
  onError: ((payload: any) => void) | null = null;

  constructor(config: {
    host: string;
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    accountId: number;
    log?: (msg: string) => void;
  }) {
    this.host = config.host;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.accountId = config.accountId;
    this.log = config.log ?? console.log;
  }

  async connect(): Promise<boolean> {
    const self = this;
    return new Promise<boolean>(function (resolve, reject) {
      self.log('Connecting to wss://' + self.host + ':5036...');
      self.ws = new WebSocket('wss://' + self.host + ':5036');

      self.ws.onopen = function () {
        self.log('WebSocket connected');
        self.pendingResolve = resolve;
        self.pendingReject = reject;
        self.sendAppAuth();
        self.startHeartbeat();
      };

      self.ws.onmessage = function (event) {
        self.handleMessage(event.data.toString());
      };

      self.ws.onerror = function (err) {
        self.log('WebSocket error: ' + err.message);
        reject(err);
      };

      self.ws.onclose = function (event) {
        self.log('WebSocket closed: code=' + event.code + ' reason=' + event.reason);
        self.authenticated = false;
        self.stopHeartbeat();
        self.scheduleReconnect();
      };
    });
  }

  private send(msg: OAMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  private sendAppAuth(): void {
    this.send({
      clientMsgId: uid(),
      payloadType: PayloadType.PROTO_OA_APPLICATION_AUTH_REQ,
      payload: {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
      },
    });
  }

  private sendAccountAuth(accessToken?: string): void {
    this.send({
      clientMsgId: uid(),
      payloadType: PayloadType.PROTO_OA_ACCOUNT_AUTH_REQ,
      payload: {
        ctidTraderAccountId: this.accountId,
        accessToken: accessToken ?? this.accessToken,
      },
    });
  }

  private handleMessage(data: string): void {
    let msg: OAMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      this.log('Failed to parse message: ' + data);
      return;
    }

    const { payloadType, payload } = msg;

    switch (payloadType) {
      case PayloadType.PROTO_OA_APPLICATION_AUTH_RES:
        this.log('App auth successful');
        this.sendAccountAuth();
        break;

      case PayloadType.PROTO_OA_ACCOUNT_AUTH_RES:
        this.log('Account auth successful');
        this.authenticated = true;
        if (this.pendingResolve) {
          this.pendingResolve(true);
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        break;

      case PayloadType.PROTO_OA_EXECUTION_EVENT:
        this.log('Execution event: ' + JSON.stringify(payload));
        if (this.onExecutionEvent) this.onExecutionEvent(payload);
        {
          const p = payload as any;
          if (p.position && p.position.positionId && this.pendingExecutionResolve) {
            this.pendingExecutionResolve(Number(p.position.positionId));
            this.pendingExecutionResolve = null;
            this.pendingExecutionReject = null;
            if (this.pendingExecutionTimer) {
              clearTimeout(this.pendingExecutionTimer);
              this.pendingExecutionTimer = null;
            }
          }
        }
        break;

      case PayloadType.PROTO_OA_ORDER_ERROR_EVENT:
        this.log('Order error: ' + JSON.stringify(payload));
        this.learnVolumeFromError(payload);
        if (this.onError) this.onError(payload);
        break;

      case PayloadType.PROTO_OA_ERROR_RES:
        this.log('Server error: ' + JSON.stringify(payload));
        {
          const p = payload as Record<string, string>;
          if (p.errorCode === 'OA_AUTH_TOKEN_EXPIRED' || p.errorCode === '1') {
            this.log('Access token expired, attempting refresh...');
            this.refreshAccessToken();
            break;
          }
          if (this.pendingReject) {
            const err = new Error('Auth failed: ' + p.errorCode + ' - ' + p.description);
            this.pendingReject(err);
            this.pendingReject = null;
            this.pendingResolve = null;
          }
        }
        if (this.onError) this.onError(payload);
        break;

      case PayloadType.PROTO_OA_REFRESH_TOKEN_RES:
        this.log('Token refreshed successfully');
        {
          const p = payload as Record<string, string>;
          if (p.accessToken) {
            this.accessToken = p.accessToken;
            if (p.refreshToken) {
              this.refreshToken = p.refreshToken;
            }
            this.log('New access token: ' + this.accessToken.substring(0, 20) + '...');
            this.sendAccountAuth(this.accessToken);
          }
        }
        break;

      case PayloadType.PROTO_OA_SYMBOLS_LIST_RES:
        {
          const symbols = (payload.symbol ?? []) as any[];
          for (const sym of symbols) {
            if (sym.symbolName) {
              this.symbolCache[sym.symbolName] = {
                symbolId: Number(sym.symbolId),
                symbolName: sym.symbolName,
                minVolume: HARDCODED_VOLUME_LIMITS[sym.symbolName]?.minVolume,
                maxVolume: HARDCODED_VOLUME_LIMITS[sym.symbolName]?.maxVolume,
              };
            }
          }
          this.log('Cached ' + Object.keys(this.symbolCache).length + ' symbols');
          if (this.pendingSymbolResolve) {
            this.pendingSymbolResolve();
            this.pendingSymbolResolve = null;
          }
        }
        break;

      case PayloadType.HEARTBEAT_EVENT:
        break;

      default:
        this.log('Unhandled message type ' + payloadType + ': ' + JSON.stringify(payload).substring(0, 200));
    }
  }

  private learnVolumeFromError(payload: any): void {
    const desc: string = payload.description || '';
    const match = desc.match(/order volume = ([\d.]+) is (smaller|bigger) than (minimum|maximum) allowed volume = ([\d.]+)/i);
    if (!match) return;

    const reported = parseFloat(match[1]);
    const limit = parseFloat(match[4]);
    const isMin = match[3].toLowerCase() === 'minimum';

    // Find which symbol from symbolKey or check via error context
    const symbolId: number | undefined = payload.symbolId || payload.ctidTraderAccountId;

    // We don't have symbol name in the error, so search symbol cache by symbolId
    for (const [name, info] of Object.entries(this.symbolCache)) {
      if (info.symbolId === (payload as any).symbolId) {
        if (isMin) {
          info.minVolume = limit;
          this.log('Learned min volume for ' + name + ': ' + limit);
        } else {
          info.maxVolume = limit;
          this.log('Learned max volume for ' + name + ': ' + limit);
        }
        break;
      }
    }
  }

  private refreshAccessToken(): void {
    this.send({
      clientMsgId: uid(),
      payloadType: PayloadType.PROTO_OA_REFRESH_TOKEN_REQ,
      payload: {
        ctidTraderAccountId: this.accountId,
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
      } as Record<string, unknown>,
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const self = this;
    this.heartbeatTimer = setInterval(function () {
      if (self.ws && self.ws.readyState === WebSocket.OPEN) {
        self.send({
          payloadType: PayloadType.HEARTBEAT_EVENT,
          payload: {},
        });
      }
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.log('Scheduling reconnect in 5s...');
    const self = this;
    this.reconnectTimer = setTimeout(async function () {
      self.reconnectTimer = null;
      try {
        await self.connect();
      } catch (err) {
        self.log('Reconnect failed: ' + err);
        self.scheduleReconnect();
      }
    }, 5000);
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  private symbolCache: Record<string, SymbolInfo> = {};
  private cachedSymbolsPromise: Promise<void> | null = null;

  async getSymbolInfo(symbolName: string): Promise<SymbolInfo | null> {
    if (this.symbolCache[symbolName]) {
      return this.symbolCache[symbolName];
    }
    await this.ensureSymbolsLoaded();
    return this.symbolCache[symbolName] ?? null;
  }

  private async ensureSymbolsLoaded(): Promise<void> {
    if (this.cachedSymbolsPromise) return this.cachedSymbolsPromise;

    const self = this;
    this.cachedSymbolsPromise = new Promise<void>(function (resolve, reject) {
      if (!self.ws || !self.authenticated) {
        reject(new Error('Not connected'));
        return;
      }

      self.pendingSymbolResolve = resolve;

      self.send({
        clientMsgId: uid(),
        payloadType: PayloadType.PROTO_OA_SYMBOLS_LIST_REQ,
        payload: {
          ctidTraderAccountId: self.accountId,
          accessToken: self.accessToken,
          includeArchivedSymbols: false,
        },
      });

      setTimeout(function () {
        if (self.pendingSymbolResolve === resolve) {
          self.pendingSymbolResolve = null;
          reject(new Error('Symbol load timeout'));
        }
      }, 15000);
    });

    return this.cachedSymbolsPromise;
  }

  async placeOrder(params: {
    symbolId: number;
    tradeSide: number;
    volume: number;
    orderType: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    comment?: string;
    stopPrice?: number;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      ctidTraderAccountId: this.accountId,
      accessToken: this.accessToken,
      symbolId: params.symbolId,
      orderType: params.orderType,
      tradeSide: params.tradeSide,
      volume: params.volume,
    };

    if (params.price != null && params.orderType === OrderType.LIMIT) {
      payload.limitPrice = params.price;
    }
    if (params.stopPrice != null && (params.orderType === OrderType.STOP || params.orderType === OrderType.STOP_LIMIT)) {
      payload.stopPrice = params.stopPrice;
    }
    if (params.stopLoss != null) payload.stopLoss = params.stopLoss;
    if (params.takeProfit != null) payload.takeProfit = params.takeProfit;
    if (params.comment) payload.comment = params.comment;

    this.send({
      clientMsgId: uid(),
      payloadType: PayloadType.PROTO_OA_NEW_ORDER_REQ,
      payload,
    });
  }

  async closePosition(positionId: number, volume?: number): Promise<void> {
    const payload: Record<string, unknown> = {
      ctidTraderAccountId: this.accountId,
      accessToken: this.accessToken,
      positionId,
    };
    if (volume != null) payload.volume = volume;

    this.send({
      clientMsgId: uid(),
      payloadType: PayloadType.PROTO_OA_CLOSE_POSITION_REQ,
      payload,
    });
  }

  async amendPositionSLTP(params: {
    positionId: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      ctidTraderAccountId: this.accountId,
      accessToken: this.accessToken,
      positionId: params.positionId,
    };
    if (params.stopLoss != null) payload.stopLoss = params.stopLoss;
    if (params.takeProfit != null) payload.takeProfit = params.takeProfit;

    this.send({
      clientMsgId: uid(),
      payloadType: PayloadType.PROTO_OA_AMEND_POSITION_SLTP_REQ,
      payload,
    });
  }

  private pendingExecutionResolve: ((posId: number) => void) | null = null;
  private pendingExecutionReject: ((err: Error) => void) | null = null;
  private pendingExecutionTimer: ReturnType<typeof setTimeout> | null = null;

  async placeMarketOrderWithSLTP(params: {
    symbolId: number;
    tradeSide: number;
    volume: number;
    stopLoss?: number;
    takeProfit?: number;
    comment?: string;
  }): Promise<void> {
    const self = this;

    // Place the order without SL/TP
    this.placeOrder({
      symbolId: params.symbolId,
      tradeSide: params.tradeSide,
      volume: params.volume,
      orderType: OrderType.MARKET,
      comment: params.comment,
    });

    // If no SL/TP, we're done
    if (params.stopLoss == null && params.takeProfit == null) return;

    // Wait for execution event to get positionId
    const positionId = await new Promise<number>(function (resolve, reject) {
      self.pendingExecutionResolve = resolve;
      self.pendingExecutionReject = reject;

      self.pendingExecutionTimer = setTimeout(function () {
        self.pendingExecutionResolve = null;
        self.pendingExecutionReject = null;
        reject(new Error('Timeout waiting for position execution'));
      }, 10000);
    });

    // Cancel timeout
    if (self.pendingExecutionTimer) {
      clearTimeout(self.pendingExecutionTimer);
      self.pendingExecutionTimer = null;
    }

    // Amend position with SL/TP
    await this.amendPositionSLTP({
      positionId,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.authenticated = false;
  }
}