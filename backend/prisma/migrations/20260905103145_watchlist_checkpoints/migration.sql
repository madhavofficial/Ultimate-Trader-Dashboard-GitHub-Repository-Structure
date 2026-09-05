-- CreateTable
CREATE TABLE "WatchlistCheckpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchlistCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistCheckpointItem" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "volume" BIGINT NOT NULL DEFAULT 0,
    "benchmarkPrice" DECIMAL(20,8),
    "sentiment" DOUBLE PRECISION,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistCheckpointItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistCheckpoint_userId_key" ON "WatchlistCheckpoint"("userId");

-- CreateIndex
CREATE INDEX "WatchlistCheckpoint_userId_lastCheckedAt_idx" ON "WatchlistCheckpoint"("userId", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "WatchlistCheckpointItem_checkpointId_idx" ON "WatchlistCheckpointItem"("checkpointId");

-- CreateIndex
CREATE INDEX "WatchlistCheckpointItem_symbol_idx" ON "WatchlistCheckpointItem"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistCheckpointItem_checkpointId_symbol_key" ON "WatchlistCheckpointItem"("checkpointId", "symbol");

-- AddForeignKey
ALTER TABLE "WatchlistCheckpoint" ADD CONSTRAINT "WatchlistCheckpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistCheckpointItem" ADD CONSTRAINT "WatchlistCheckpointItem_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "WatchlistCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
