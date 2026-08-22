import { Server } from "socket.io";
import { updateLtpAndBroadcast } from "./portfolioService";

export function startMockKiteStream(io: Server) {
  console.log("Starting mock Kite market stream...");

  // List of fake instruments
  const instruments = [
    { token: 1, symbol: "INFY", price: 1520 },
    { token: 2, symbol: "RELIANCE", price: 2485 },
    { token: 3, symbol: "TCS", price: 3805 },
  ];

  // Emit a fake tick every second
  setInterval(() => {
    const ticks = instruments.map((inst) => {
      // random price movement
      const change = (Math.random() - 0.5) * 5;
      inst.price = Math.max(1, inst.price + change);

      return {
        token: inst.token,
        symbol: inst.symbol,
        last_price: Number(inst.price.toFixed(2)),
        change: Number(change.toFixed(2)),
      };
    });

    io.emit("tick", ticks);
    void updateLtpAndBroadcast(io, ticks);
    console.log("ticks:", ticks);
  }, 1000);
}