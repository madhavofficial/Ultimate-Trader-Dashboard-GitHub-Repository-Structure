-- CreateTable
CREATE TABLE "RiskSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maxDailyLoss" DECIMAL(20,8) NOT NULL DEFAULT 50000,
    "maxPositionSize" DECIMAL(20,8) NOT NULL DEFAULT 200000,
    "maxSectorExposurePct" DOUBLE PRECISION NOT NULL DEFAULT 35.0,
    "killSwitchActive" BOOLEAN NOT NULL DEFAULT false,
    "stopLossDefaultPct" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "takeProfitDefaultPct" DOUBLE PRECISION NOT NULL DEFAULT 4.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "technicalScore" DOUBLE PRECISION,
    "sentimentScore" DOUBLE PRECISION,
    "macroScore" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "horizon" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "keyFactors" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeJournal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "strategyTag" TEXT,
    "conviction" INTEGER NOT NULL DEFAULT 3,
    "notes" TEXT,
    "setupSnapshot" JSONB,
    "pnlRealized" DECIMAL(20,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertId" TEXT,
    "symbol" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DELIVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RiskSettings_userId_key" ON "RiskSettings"("userId");

-- CreateIndex
CREATE INDEX "Signal_symbol_createdAt_idx" ON "Signal"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "Signal_status_createdAt_idx" ON "Signal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradeJournal_userId_symbol_idx" ON "TradeJournal"("userId", "symbol");

-- CreateIndex
CREATE INDEX "TradeJournal_userId_createdAt_idx" ON "TradeJournal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertNotification_userId_createdAt_idx" ON "AlertNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertNotification_symbol_createdAt_idx" ON "AlertNotification"("symbol", "createdAt");

-- AddForeignKey
ALTER TABLE "RiskSettings" ADD CONSTRAINT "RiskSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeJournal" ADD CONSTRAINT "TradeJournal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertNotification" ADD CONSTRAINT "AlertNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
