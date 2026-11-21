import { config } from "dotenv";
import { toTestDatabaseUrl } from "./test-database-url.js";

// Runs before every test file, before the app is imported.
config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = toTestDatabaseUrl(process.env.DATABASE_URL);

// Fake SSLCommerz store. Payment tests replace the gateway's HTTP calls (fetch) with fakes,
// so tests never reach SSLCommerz, even when real store credentials are in .env.
process.env.SSLC_STORE_ID = "tasknest_test_store";
process.env.SSLC_STORE_PASSWORD = "tasknest_test_password";
process.env.SSLC_IS_LIVE = "false";
