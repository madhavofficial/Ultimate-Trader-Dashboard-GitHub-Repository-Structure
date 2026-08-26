import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { startMockKiteStream } from "./services/kiteMockStream";
import authRoutes from "./routes/auth";
import portfolioRoutes from "./routes/portfolio";
import tradeRoutes from "./routes/trades";
import alertRoutes from "./routes/alerts";
import kiteRoutes from "./routes/kite";
import marketRoutes from "./routes/market";
import intelligenceRoutes from "./routes/intelligence";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { prisma } from "./db/client";
import jwt from "jsonwebtoken";
import { userRoom } from "./services/socketRooms";
import { startInstrumentSyncScheduler } from "./services/instrumentService";
import { startNewsWorkerScheduler, stopNewsWorkerScheduler } from "./workers/newsWorker";


const corsOrigins = [env.CORS_ORIGIN, "http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"];
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || corsOrigins.includes(origin) || (env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Ultimate Trader Backend running" });
});

app.get("/health", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, database: "ok" });
  } catch (error) {
    return next(error);
  }
});

app.use("/auth", authRoutes);
app.use("/portfolio", portfolioRoutes);
app.use("/trades", tradeRoutes);
app.use("/alerts", alertRoutes);
app.use("/broker/kite", kiteRoutes);
app.use("/market", marketRoutes);
app.use("/intelligence", intelligenceRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export function createHttpServer() {
  const server = http.createServer(app);
  const io = new Server(server, { cors: corsOptions });
  app.set("io", io);


  if (env.MARKET_DATA_MODE === "kite") {
    io.use((socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("Socket authentication required"));
        const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
        if (!payload.sub) return next(new Error("Invalid socket token"));
        socket.data.userId = payload.sub;
        return next();
      } catch {
        return next(new Error("Invalid socket token"));
      }
    });
  }

  io.on("connection", (socket) => {
    if (!socket.data.userId && socket.handshake.auth?.token) {
      try {
        const payload = jwt.verify(socket.handshake.auth.token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
        if (payload.sub) socket.data.userId = payload.sub;
      } catch {
        // Mock mode keeps public tick streaming, but invalid optional auth gets no private room.
      }
    }
    if (socket.data.userId) socket.join(userRoom(socket.data.userId));
    socket.on("ping", (payload) => socket.emit("pong", { msg: "pong", received: payload }));
  });

  if (env.MARKET_DATA_MODE === "mock") startMockKiteStream(io);
  startNewsWorkerScheduler(io);
  return server;
}

export async function startServer() {
  const server = createHttpServer();
  server.listen(env.PORT, () => console.log(`Backend listening on http://localhost:${env.PORT}`));
  const stopInstrumentScheduler = env.MARKET_DATA_MODE === "kite" && env.KITE_SYNC_USER_ID
    ? startInstrumentSyncScheduler(env.KITE_SYNC_USER_ID)
    : undefined;

  const shutdown = async () => {
    stopInstrumentScheduler?.();
    stopNewsWorkerScheduler();
    server.close();
    await prisma.$disconnect();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
