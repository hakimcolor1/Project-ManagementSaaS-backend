import { config } from "dotenv";
import { z } from "zod";

// Load .env for local development. On Vercel the variables come from the project settings.
config({ quiet: true });

/** A duration such as "30s", "15m", "12h" or "7d". */
const duration = z.string().regex(/^\d+[smhd]$/, 'Use a duration like "15m", "12h" or "7d"');

/** An empty value in .env (KEY=) counts as "not set". */
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  APP_URL: z
    .url()
    .default("http://localhost:5000")
    .transform((url) => url.replace(/\/+$/, "")),
  CORS_ORIGINS: z.string().default("*"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a PostgreSQL connection string"),

  JWT_ACCESS_SECRET: z
    .string({ error: "JWT_ACCESS_SECRET is required" })
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string({ error: "JWT_REFRESH_SECRET is required" })
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_EXPIRES_IN: duration.default("15m"),
  JWT_REFRESH_EXPIRES_IN: duration.default("7d"),

  // Optional: without them, Google login answers 503 "not configured".
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Only variable names and rule messages are printed, never the values.
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment variables:\n${problems}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
