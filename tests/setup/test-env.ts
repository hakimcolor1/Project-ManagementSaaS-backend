import { config } from "dotenv";
import { toTestDatabaseUrl } from "./test-database-url.js";

// Runs before every test file, before the app is imported.
config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = toTestDatabaseUrl(process.env.DATABASE_URL);
