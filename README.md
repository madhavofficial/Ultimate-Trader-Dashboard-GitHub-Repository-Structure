# Ultimate Trader Dashboard

The project is currently implementing Phase 0: a persistent backend foundation for a paper-trading and market-intelligence dashboard.

## Backend setup

```bash
cd backend
cp .env.example .env
npm install
docker compose -f ../docker-compose.yml up -d database
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

The API listens on `http://localhost:8000`.

Useful checks:

```bash
npm run build
npm test
RUN_INTEGRATION_TESTS=1 npm run test:integration
curl http://localhost:8000/
curl http://localhost:8000/health
```

Phase 0 includes Prisma-backed users, refresh sessions, trades, alerts, holdings, audit logs, durable event/job models, request validation, centralized errors, and secure default HTTP configuration. Broker, news, LLM, and automated execution integrations are intentionally not part of this phase.

## Phase 1A: read-only Zerodha connection

Set `MARKET_DATA_MODE=kite` and configure the Kite values in `backend/.env`. The backend exposes:

- `GET /broker/kite/login` — authenticated endpoint returning the official Kite login URL
- `GET /broker/kite/callback` — exchanges the one-time request token and encrypts the access token
- `POST /broker/kite/sync/holdings` — read-only holdings synchronization
- `POST /broker/kite/stream/start` and `/stop` — controls backend-owned KiteTicker streaming

Provide `KITE_TOKEN_ENCRYPTION_KEY` as 64 hexadecimal characters. Order placement is not exposed in this phase.

## Paper dashboard

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

The dashboard provides login, live/mock watchlist prices, paper buy/sell orders, holdings, and unrealized P&amp;L. Instrument search and synchronization are available through the backend market routes.
