export const PayloadType = {
  // Auth
  PROTO_OA_APPLICATION_AUTH_REQ: 2100,
  PROTO_OA_APPLICATION_AUTH_RES: 2101,
  PROTO_OA_ACCOUNT_AUTH_REQ: 2102,
  PROTO_OA_ACCOUNT_AUTH_RES: 2103,
  PROTO_OA_REFRESH_TOKEN_REQ: 2173,
  PROTO_OA_REFRESH_TOKEN_RES: 2174,

  // Trading
  PROTO_OA_NEW_ORDER_REQ: 2106,
  PROTO_OA_CANCEL_ORDER_REQ: 2108,
  PROTO_OA_AMEND_ORDER_REQ: 2109,
  PROTO_OA_AMEND_POSITION_SLTP_REQ: 2110,
  PROTO_OA_CLOSE_POSITION_REQ: 2111,
  PROTO_OA_EXECUTION_EVENT: 2126,
  PROTO_OA_ORDER_ERROR_EVENT: 2132,

  // Data
  PROTO_OA_SYMBOLS_LIST_REQ: 2114,
  PROTO_OA_SYMBOLS_LIST_RES: 2115,
  PROTO_OA_SYMBOL_BY_ID_REQ: 2116,
  PROTO_OA_SYMBOL_BY_ID_RES: 2117,
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,

  // Common
  PROTO_OA_ERROR_RES: 2142,
  HEARTBEAT_EVENT: 51,
} as const;

export const OrderType = {
  MARKET: 1,
  LIMIT: 2,
  STOP: 3,
  STOP_LOSS_TAKE_PROFIT: 4,
  MARKET_RANGE: 5,
  STOP_LIMIT: 6,
} as const;

export const TradeSide = {
  BUY: 1,
  SELL: 2,
} as const;

export interface OAMessage {
  clientMsgId?: string;
  payloadType: number;
  payload: Record<string, unknown>;
}

export interface TradingViewAlert {
  action: 'BUY' | 'SELL' | 'CLOSE';
  symbol?: string;
  symbolId?: number;
  volume?: number;
  orderType?: 'MARKET' | 'LIMIT' | 'STOP';
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
}

export interface EnvConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  ctidTraderAccountId: number;
  ctraderHost: string;
  port: number;
  webhookSecret: string;
}
