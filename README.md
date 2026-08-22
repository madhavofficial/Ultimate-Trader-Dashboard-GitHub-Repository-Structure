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
