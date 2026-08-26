ALTER TABLE "BrokerSession" ADD COLUMN "profile" JSONB;

CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "instrumentToken" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "averagePrice" DECIMAL(20,8) NOT NULL,
    "lastPrice" DECIMAL(20,8) NOT NULL,
    "pnl" DECIMAL(20,8) NOT NULL,
    "m2m" DECIMAL(20,8) NOT NULL,
    "unrealized" DECIMAL(20,8) NOT NULL,
    "realized" DECIMAL(20,8) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Position_userId_exchange_symbol_product_key" ON "Position"("userId", "exchange", "symbol", "product");
CREATE INDEX "Position_userId_updatedAt_idx" ON "Position"("userId", "updatedAt");

ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
