ALTER TABLE "Trade" ALTER COLUMN "price" TYPE DECIMAL(20,8) USING "price"::DECIMAL(20,8);
ALTER TABLE "Holding" ALTER COLUMN "avg" TYPE DECIMAL(20,8) USING "avg"::DECIMAL(20,8);

CREATE TABLE "PortfolioAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cashBalance" DECIMAL(20,8) NOT NULL DEFAULT 1000000,
    "reservedMargin" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortfolioAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "balanceAfter" DECIMAL(20,8) NOT NULL,
    "realizedPnl" DECIMAL(20,8),
    "reason" TEXT NOT NULL,
    "tradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "instrumentToken" INTEGER NOT NULL,
    "exchangeToken" INTEGER,
    "tradingsymbol" TEXT NOT NULL,
    "name" TEXT,
    "lastPrice" DECIMAL(20,8),
    "expiry" TIMESTAMP(3),
    "strike" DECIMAL(20,8),
    "tickSize" DECIMAL(20,8) NOT NULL,
    "lotSize" INTEGER NOT NULL,
    "instrumentType" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortfolioAccount_userId_key" ON "PortfolioAccount"("userId");
CREATE INDEX "CashLedgerEntry_userId_createdAt_idx" ON "CashLedgerEntry"("userId", "createdAt");
CREATE UNIQUE INDEX "Instrument_exchange_tradingsymbol_key" ON "Instrument"("exchange", "tradingsymbol");
CREATE INDEX "Instrument_tradingsymbol_idx" ON "Instrument"("tradingsymbol");
CREATE INDEX "Instrument_name_idx" ON "Instrument"("name");
CREATE INDEX "Instrument_instrumentToken_idx" ON "Instrument"("instrumentToken");

ALTER TABLE "PortfolioAccount" ADD CONSTRAINT "PortfolioAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashLedgerEntry" ADD CONSTRAINT "CashLedgerEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
