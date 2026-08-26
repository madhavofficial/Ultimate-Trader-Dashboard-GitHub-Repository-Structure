import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const emptyToUndefined = z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  MARKET_DATA_MODE: z.enum(["mock", "kite", "disabled"]).default("mock"),
  KITE_API_KEY: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().optional()),
  KITE_API_SECRET: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().optional()),
  KITE_REDIRECT_URL: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().url().optional()),
  KITE_TOKEN_ENCRYPTION_KEY: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().regex(/^[0-9a-fA-F]{64}$/).optional()),
  KITE_SYNC_USER_ID: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().uuid().optional()),
  GEMINI_API_KEY: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().optional()),
  OPENAI_API_KEY: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().optional()),
  TELEGRAM_BOT_TOKEN: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().optional()),
  TELEGRAM_CHAT_ID: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().optional()),
  WEBHOOK_URL: z.preprocess((val) => (typeof val === "string" && val.trim() === "" ? undefined : val), z.string().url().optional()),
});

export const env = envSchema.parse(process.env);


