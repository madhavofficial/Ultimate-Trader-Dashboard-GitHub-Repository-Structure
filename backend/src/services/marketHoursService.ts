export type MarketSession = "PRE_MARKET" | "REGULAR_SESSION" | "POST_MARKET" | "CLOSED" | "WEEKEND";

export interface MarketStatus {
  session: MarketSession;
  isOpen: boolean;
  nextOpenTime?: string;
  istTime: string;
  message: string;
}

export function getCurrentMarketStatus(date = new Date()): MarketStatus {
  // Convert to Indian Standard Time (UTC + 5:30)
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istDate = new Date(utc + 5.5 * 3600000);

  const day = istDate.getDay(); // 0 = Sun, 6 = Sat
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const istTimeString = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} IST`;

  // Weekend check
  if (day === 0 || day === 6) {
    return {
      session: "WEEKEND",
      isOpen: false,
      istTime: istTimeString,
      message: "Market closed for the weekend (NSE/BSE). Opens Monday at 09:15 IST.",
    };
  }

  // Pre-market: 09:00 to 09:08 IST (540 to 548 mins)
  if (totalMinutes >= 540 && totalMinutes < 548) {
    return {
      session: "PRE_MARKET",
      isOpen: true,
      istTime: istTimeString,
      message: "Pre-market order collection session active (09:00 - 09:08 IST).",
    };
  }

  // Regular Trading Session: 09:15 to 15:30 IST (555 to 930 mins)
  if (totalMinutes >= 555 && totalMinutes <= 930) {
    return {
      session: "REGULAR_SESSION",
      isOpen: true,
      istTime: istTimeString,
      message: "Regular continuous trading session active (09:15 - 15:30 IST).",
    };
  }

  // Post-market: 15:40 to 16:00 IST (940 to 960 mins)
  if (totalMinutes >= 940 && totalMinutes <= 960) {
    return {
      session: "POST_MARKET",
      isOpen: false,
      istTime: istTimeString,
      message: "Post-market closing price determination session (15:40 - 16:00 IST).",
    };
  }

  return {
    session: "CLOSED",
    isOpen: false,
    istTime: istTimeString,
    message: "Market is currently closed. Regular trading resumes at 09:15 IST.",
  };
}

/**
 * Computes Indian regulatory and statutory charges for equity delivery / intraday
 * Rates based on current SEBI / NSE circulars
 */
export function calculateStatutoryCharges(turnover: number, isDelivery = true, isSell = false) {
  // 1. Securities Transaction Tax (STT)
  // Delivery: 0.1% on Buy & Sell; Intraday: 0.025% on Sell only
  let stt = 0;
  if (isDelivery) {
    stt = turnover * 0.001;
  } else if (isSell) {
    stt = turnover * 0.00025;
  }

  // 2. Exchange Transaction Charges (NSE: 0.00297%)
  const exchangeCharges = turnover * 0.0000297;

  // 3. SEBI Turnover Charges (₹10 per crore = 0.0001%)
  const sebiCharges = turnover * 0.000001;

  // 4. Stamp Duty (0.015% on Buy delivery, 0.003% on Buy intraday)
  let stampDuty = 0;
  if (!isSell) {
    stampDuty = isDelivery ? turnover * 0.00015 : turnover * 0.00003;
  }

  // 5. GST (18% on Brokerage + Exchange charges + SEBI charges)
  const gst = (exchangeCharges + sebiCharges) * 0.18;

  const totalCharges = stt + exchangeCharges + sebiCharges + stampDuty + gst;

  return {
    turnover: Number(turnover.toFixed(2)),
    stt: Number(stt.toFixed(2)),
    exchangeCharges: Number(exchangeCharges.toFixed(2)),
    sebiCharges: Number(sebiCharges.toFixed(2)),
    stampDuty: Number(stampDuty.toFixed(2)),
    gst: Number(gst.toFixed(2)),
    totalCharges: Number(totalCharges.toFixed(2)),
    effectivePct: Number(((totalCharges / turnover) * 100).toFixed(4)),
  };
}
