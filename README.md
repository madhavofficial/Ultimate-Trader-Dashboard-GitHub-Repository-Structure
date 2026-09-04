# Ultimate Trader Dashboard

An institutional-grade, full-stack quantitative cockpit and market intelligence terminal for Indian Equities (NSE/BSE). Built with Next.js 15, Node.js/Express, TypeScript, Prisma, PostgreSQL, and Socket.io.

---

## Key Features

### 1. Real-Time Market Microstructure & Streaming
- **Dual-Mode Market Feeds:** Seamlessly toggle between live Zerodha KiteTicker WebSocket streaming and an in-memory high-frequency mock stream.
- **Market Hours Engine:** Evaluates Indian market trading sessions (`PRE_OPEN`, `REGULAR`, `POST_MARKET`, `CLOSED`) based on IST market timings and holidays.
- **Interactive Candlestick Action:** 5-minute, 15-minute, and daily OHLCV candlestick charting with responsive candle hover metrics and tooltips.
- **Instrument Master Sync:** Search and autocomplete across thousands of NSE equity symbols with background batch synchronization.

### 2. AI Market Intelligence & Event Ingestion
- **Automated RSS News Ingestion:** Ingests live financial headlines from major Indian financial media (Mint, Business Standard).
- **LLM Sentiment Extraction:** Analyzes news sentiment (-1.0 to +1.0), event classification (`MACRO`, `EARNINGS`, `REGULATORY`), and confidence metrics using Groq (Llama 3) and Gemini with structured Zod validation.
- **Sector Knowledge Graph & Ripple Engine:** Models second-order transmission impacts across linked sectors (e.g. crude oil price surges propagating negative pressure to paint and aviation sectors).

### 3. Execution & Virtual Paper Trading Ledger
- **Virtual Cash Ledger:** Double-entry ledger tracking cash balance, margin reservation, and realized/unrealized P&L across all holdings.
- **Dynamic Cost Averaging:** Real-time recalculation of weighted average buy prices when scaling into positions.
- **Indian Statutory Charges Engine:** Accurate calculation of STT (Securities Transaction Tax), GST, SEBI turnover fees, exchange transaction charges, and stamp duty for delivery and intraday orders.

### 4. Zerodha Kite Live Broker Integration
- **Secure Broker OAuth:** Authenticated login flow with encrypted token exchange (`AES-256-GCM`).
- **Live Order Execution:** Direct KiteConnect live order placement with pre-trade price verification and stale-quote rejection.
- **Live Margin & Order Tracking:** Real-time visibility into equity margin utilization, cash balances, collateral, and order status histories.

### 5. Enterprise Risk Management & Controls
- **Pre-Trade Risk Engine:** Validates all incoming orders against portfolio constraints prior to submission.
- **Emergency Kill Switch:** Instant global circuit breaker to freeze new order execution during periods of high market volatility.
- **Daily Loss Guardrails:** Automatic trading freeze upon exceeding maximum daily drawdown thresholds.
- **Concentration Limits:** Configurable ceilings for single-position sizing and sector exposure percentages.

### 6. Multi-Factor Quantitative Signal Engine
- **Composite Scoring:** Merges technical indicators (RSI oscillators, SMA trends), AI sentiment, and macro indicators into unified conviction scores.
- **Strategy Horizons:** Categorizes actionable setups into Intraday, Swing, and Positional trade horizons with explicit rationales.

### 7. Real-Time Alerts & Notification Dispatcher
- **Threshold Alert Engine:** Server-side price threshold evaluation against incoming tick streams (`GT` / `LT`).
- **Multi-Channel Dispatcher:** Routes notifications across In-App toasts, Telegram bots, and external Webhooks.
- **Deduplication Cooldown:** Intelligent alert throttling to prevent spamming during high volatility.

### 8. Quant Analytics & Performance Attribution
- **Performance Metrics:** Real-time calculation of win rate %, profit factor, Sharpe ratio, and maximum drawdown.
- **Sector Performance Attribution:** Granular P&L attribution and trade volume breakdown by industry sector.

### 9. Architecture, Security & Production Readiness
- **Next.js 15 App Router:** Modern dark-theme trading cockpit with modular tabbed navigation and real-time state synchronization.
- **Durable Job & Event Queues:** Background workers for instrument sync, news processing, and data retention pruning.
- **Security Defaults:** JWT access and HTTP-only refresh cookies with rotation, rate limiting, and Helmet headers.
- **Automated Test Suite:** Comprehensive test suite covering risk engines, paper trading math, sentiment boundaries, and statutory charges.
- **CI/CD Pipeline:** GitHub Actions workflow executing database migrations, builds, and unit/integration tests on every commit.

---

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Docker (optional)

### Backend Setup

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

The API listens on `http://localhost:8000`.

### Frontend Setup

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

The dashboard will be accessible at `http://localhost:3000`.

### Running Tests

```bash
cd backend
npm test
RUN_INTEGRATION_TESTS=1 npm run test:integration
```
