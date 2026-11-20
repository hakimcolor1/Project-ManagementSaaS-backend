import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Must end with "&schema=tasknest" so Prisma only works inside the TaskNest schema.
    // Read directly (not via env()) so `prisma generate` also works without a database URL.
    url: process.env.DATABASE_URL,
  },
});
