import WebSocket from 'ws';
import { PayloadType, OrderType, TradeSide, OAMessage } from './types.js';

let msgCounter = 1;
function uid(): string {
  return 'cm_id_' + (msgCounter++);
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
    return new Promise<boolean>((resolve, reject) => {
      this.log(Connecting to wss://\:5036...);
      this.ws = new WebSocket(wss://\:5036);

      this.ws.onopen = () => {
        this.log('WebSocket connected');
        this.pendingResolve = resolve;
        this.pendingReject = reject;
        this.sendAppAuth();
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data.toString());
      };

      this.ws.onerror = (err) => {
        this.log(WebSocket error: \);
        reject(err);
      };

      this.ws.onclose = (event) => {
        this.log(WebSocket closed: code=\ reason=\);
        this.authenticated = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
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
      this.log(Failed to parse message: \);
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
        this.log(Execution event: \);
        if (this.onExecutionEvent) this.onExecutionEvent(payload);
        break;

      case PayloadType.PROTO_OA_ORDER_ERROR_EVENT:
        this.log(Order error: \);
        if (this.onError) this.onError(payload);
        break;

      case PayloadType.PROTO_OA_ERROR_RES:
        this.log(Server error: \);
        {
          const p = payload as Record<string, string>;
          if (p.errorCode === 'OA_AUTH_TOKEN_EXPIRED' || p.errorCode === '1') {
            this.log('Access token expired, attempting refresh...');
            this.refreshAccessToken();
            break;
          }
          // Auth failure during connect - reject the promise
          if (this.pendingReject) {
            const err = new Error(Auth failed: \ - \);
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
            this.log(New access token: \...);
            this.sendAccountAuth(this.accessToken);
          }
        }
        break;

      case PayloadType.HEARTBEAT_EVENT:
        break;

      default:
        this.log(Unhandled message type \: \);
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
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({
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
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        this.log(Reconnect failed: \);
        this.scheduleReconnect();
      }
    }, 5000);
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  private symbolCache: Record<string, number> = {};
  private cachedSymbolsPromise: Promise<void> | null = null;

  async getSymbolId(symbolName: string): Promise<number | null> {
    if (this.symbolCache[symbolName]) {
      return this.symbolCache[symbolName];
    }
    await this.ensureSymbolsLoaded();
    return this.symbolCache[symbolName] ?? null;
  }

  private async ensureSymbolsLoaded(): Promise<void> {
    if (this.cachedSymbolsPromise) return this.cachedSymbolsPromise;

    this.cachedSymbolsPromise = new Promise<void>((resolve, reject) => {
      if (!this.ws || !this.authenticated) {
        reject(new Error('Not connected'));
        return;
      }

      const listener = (data: string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.payloadType === PayloadType.PROTO_OA_SYMBOLS_LIST_RES) {
            this.ws?.removeListener('message', listener);
            const symbols = msg.payload.symbol ?? [];
            for (const sym of symbols) {
              if (sym.symbolName) {
                this.symbolCache[sym.symbolName] = Number(sym.symbolId);
              }
            }
            this.log(Cached \ symbols);
            resolve();
          }
        } catch { }
      };

      this.ws!.on('message', listener);

      this.send({
        clientMsgId: uid(),
        payloadType: PayloadType.PROTO_OA_SYMBOLS_LIST_REQ,
        payload: {
          ctidTraderAccountId: this.accountId,
          accessToken: this.accessToken,
          includeArchivedSymbols: false,
        },
      });

      setTimeout(() => {
        this.ws?.removeListener('message', listener);
        reject(new Error('Symbol load timeout'));
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