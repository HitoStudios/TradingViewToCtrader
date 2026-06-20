import express from 'express';
import { CTraderClient } from './ctrader-client.js';
import { createWebhookRouter } from './webhook-handler.js';

function loadConfig() {
  const required = [
    'CLIENT_ID',
    'CLIENT_SECRET',
    'ACCESS_TOKEN',
    'REFRESH_TOKEN',
    'CTID_TRADER_ACCOUNT_ID',
  ] as const;

  for (const key of required) {
    if (!process.env[key]) {
      console.error('Missing required env var: ' + key);
      process.exit(1);
    }
  }

  return {
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET!,
    accessToken: process.env.ACCESS_TOKEN!,
    refreshToken: process.env.REFRESH_TOKEN!,
    ctidTraderAccountId: Number(process.env.CTID_TRADER_ACCOUNT_ID),
    ctraderHost: process.env.CTRADER_HOST || 'demo.ctraderapi.com',
    port: Number(process.env.PORT) || 3000,
    webhookSecret: process.env.WEBHOOK_SECRET || 'change-me',
  };
}

async function main() {
  const config = loadConfig();

  const client = new CTraderClient({
    host: config.ctraderHost,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    accountId: config.ctidTraderAccountId,
  });

  console.log('Connecting to cTrader Open API...');
  try {
    await client.connect();
    console.log('Connected and authenticated to cTrader');
  } catch (err) {
    console.error('Failed to connect to cTrader:', err);
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  app.use(createWebhookRouter(client, config.webhookSecret));

  app.listen(config.port, () => {
    console.log('TradingView cTrader bridge listening on port ' + config.port);
    console.log('Webhook endpoint: POST http://localhost:' + config.port + '/webhook');
    console.log('Health check:    GET  http://localhost:' + config.port + '/health');
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    client.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);