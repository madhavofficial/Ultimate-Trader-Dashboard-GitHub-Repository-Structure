CREATE TABLE "BrokerSession" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'ZERODHA',
    "brokerUserId" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "BrokerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrokerSession_userId_provider_key" ON "BrokerSession"("userId", "provider");
CREATE INDEX "BrokerSession_provider_expiresAt_idx" ON "BrokerSession"("provider", "expiresAt");

ALTER TABLE "BrokerSession" ADD CONSTRAINT "BrokerSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
