import dotenv from "dotenv";
dotenv.config();
import bcrypt from "bcrypt";
import { prisma } from "./client";

const seedEmail = process.env.SEED_EMAIL;

const seedPassword = process.env.SEED_PASSWORD;

if (!seedEmail || !seedPassword) {
  throw new Error("SEED_EMAIL and SEED_PASSWORD must be set before running the seed");
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: seedEmail.toLowerCase() },
    update: {},
    create: { email: seedEmail.toLowerCase(), passwordHash: await bcrypt.hash(seedPassword, 12) },
  });
  await prisma.portfolioAccount.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });

  const holdings = [
    { symbol: "INFY", qty: 10, avg: 1500 },
    { symbol: "RELIANCE", qty: 5, avg: 2400 },
    { symbol: "TCS", qty: 2, avg: 3800 },
  ];
  const watchlist = ["INFY", "RELIANCE", "TCS"];

  await prisma.$transaction([
    ...holdings.map((holding) => prisma.holding.upsert({
      where: { userId_symbol: { userId: user.id, symbol: holding.symbol } },
      update: holding,
      create: { ...holding, userId: user.id },
    })),
    ...watchlist.map((symbol) => prisma.watchlistItem.upsert({
      where: { userId_symbol: { userId: user.id, symbol } },
      update: {},
      create: { userId: user.id, symbol },
    })),
  ]);

  console.log(`Seeded demo data for ${user.email}`);

  // Seed an initial checkpoint/baseline for the demo user
  // so they see meaningful delta data on first visit rather than "first visit" state
  const demoCheckpointPrices: Record<string, { price: number; volume: number }> = {
    INFY: { price: 1505, volume: 810000 },
    RELIANCE: { price: 2460, volume: 1430000 },
    TCS: { price: 3790, volume: 480000 },
  };

  const existingCheckpoint = await prisma.watchlistCheckpoint.findUnique({
    where: { userId: user.id },
  });

  if (!existingCheckpoint) {
    // Only seed checkpoint if none exists — preserve user's actual checkpoint if they've used the app
    const checkpoint = await prisma.watchlistCheckpoint.create({
      data: {
        userId: user.id,
        lastCheckedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      },
    });

    await prisma.watchlistCheckpointItem.createMany({
      data: watchlist.map((symbol) => ({
        checkpointId: checkpoint.id,
        symbol,
        price: demoCheckpointPrices[symbol]?.price ?? 1000,
        volume: BigInt(demoCheckpointPrices[symbol]?.volume ?? 100000),
        benchmarkPrice: null,
        sentiment: null,
        eventCount: 0,
        observedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      })),
    });

    console.log(`Seeded demo checkpoint for ${user.email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
