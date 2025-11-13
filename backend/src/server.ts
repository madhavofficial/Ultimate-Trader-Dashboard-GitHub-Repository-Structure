import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { startMockKiteStream } from "./services/kiteMockStream";
import authRoutes from "./routes/auth";
import portfolioRoutes from "./routes/portfolio";
import tradeRoutes from "./routes/trades";
import alertRoutes from "./routes/alerts";
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

const app = express();
app.use(cors());
app.use(express.json());

// simple health route
app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Ultimate Trader Backend running' });
});

// create HTTP server and socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // a simple echo for testing
  socket.on('ping', (payload) => {
    console.log('ping received', payload);
    socket.emit('pong', { msg: 'pong', received: payload });
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', socket.id, 'reason:', reason);
  });
});

startMockKiteStream(io);
app.use("/auth", authRoutes);
app.use("/portfolio", portfolioRoutes);
app.use("/trades", tradeRoutes);
app.use("/alerts", alertRoutes);

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});