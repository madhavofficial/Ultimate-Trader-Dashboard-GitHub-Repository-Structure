import { z } from "zod";

export const tradeInputSchema = z.object({
  symbol: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
  qty: z.coerce.number().int().positive().safe(),
  price: z.coerce.number().finite().positive().max(1_000_000_000),
  side: z.enum(["BUY", "SELL"]),
});

export const alertInputSchema = z.object({
  symbol: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
  condition: z.enum(["GT", "GTE", "LT", "LTE"]),
  value: z.coerce.number().finite(),
});
