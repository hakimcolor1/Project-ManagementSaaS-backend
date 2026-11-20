import { config } from "dotenv";
import { z } from "zod";

// Load .env for local development. On Vercel the variables come from the project settings.
config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  APP_URL: z.url().default("http://localhost:5000"),
  CORS_ORIGINS: z.string().default("*"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a PostgreSQL connection string"),
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
