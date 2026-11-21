/**
 * Builds the Postman collection + environment in docs/ from ./definitions.ts and records a real
 * example response for every request.
 *
 * Recording runs the whole collection, in order, in-process against the separate
 * "tasknest_test" schema (reset and seeded first). Only SSLCommerz is simulated, so no payment
 * happens and nothing leaves this machine. Tokens in the examples are redacted.
 *
 *   npm run docs:postman
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import { config } from "dotenv";
import { toTestDatabaseUrl } from "../../tests/setup/test-database-url.js";
import { DEMO_VAL_ID, folders, type RequestDef, type TokenVar } from "./definitions.js";

// Same isolation as the tests: own schema, fake store, no Google, no rate limits, no cache.
config({ quiet: true });
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = toTestDatabaseUrl(process.env.DATABASE_URL);
process.env.SSLC_STORE_ID = "tasknest_docs_store";
process.env.SSLC_STORE_PASSWORD = "tasknest_docs_password";
process.env.SSLC_IS_LIVE = "false";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";

const COLLECTION_FILE = "docs/TaskNest.postman_collection.json";
const ENVIRONMENT_FILE = "docs/TaskNest.local.postman_environment.json";
const PRODUCTION_ENVIRONMENT_FILE = "docs/TaskNest.production.postman_environment.json";
const LOCAL_BASE_URL = "http://localhost:5000/api/v1";
const PRODUCTION_BASE_URL = "https://tasknest-backend-blush.vercel.app/api/v1";
const JSON_HEADER = { key: "Content-Type", value: "application/json; charset=utf-8" };

function run(command: string): void {
  try {
    execSync(command, { env: process.env, stdio: "pipe" });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`${command} failed:\n${stdout?.toString() ?? ""}${stderr?.toString() ?? ""}`);
  }
}

// ── 1. Fresh test schema with the demo accounts ───────────────────────────────────────
console.log("Preparing the tasknest_test schema…");
run("npx prisma migrate deploy");
const { resetDatabase } = await import("../../tests/helpers/db.js");
await resetDatabase();
run("npx tsx prisma/seed.ts");

// ── 2. Fake SSLCommerz (session + validation APIs) ────────────────────────────────────
const vars = new Map<string, string>([
  ["valId", DEMO_VAL_ID],
  ["dueDate", new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)],
]);
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.endsWith("/gwprocess/v4/api.php")) {
    return Response.json({
      status: "SUCCESS",
      GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/testcdeDEMO0001",
      sessionkey: "DEMO0001",
    });
  }
  if (url.pathname.endsWith("/validator/api/validationserverAPI.php")) {
    const tranId = vars.get("tranId");
    if (url.searchParams.get("val_id") === DEMO_VAL_ID && tranId) {
      return Response.json({
        status: "VALID",
        tran_id: tranId,
        val_id: DEMO_VAL_ID,
        amount: "500.00",
        currency: "BDT",
        currency_type: "BDT",
        currency_amount: "500.00",
        bank_tran_id: "2611201234567",
        card_type: "VISA-Dutch Bangla",
        card_no: "418117XXXXXX6675",
        risk_level: "0",
        risk_title: "Safe",
      });
    }
    return Response.json({ status: "INVALID_TRANSACTION" });
  }
  throw new Error(`Unexpected HTTP call while recording: ${url.toString()}`);
}) as typeof fetch;

// ── 3. Run every request in order and record the responses ────────────────────────────
const { default: request } = await import("supertest");
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/lib/prisma.js");

const timestamp = String(Math.floor(Date.now() / 1000));
const resolve = (text: string) =>
  text.replace(/\{\{\s*([$\w]+)\s*\}\}/g, (_match, key: string) =>
    key === "$timestamp" ? timestamp : (vars.get(key) ?? ""),
  );
const resolveAll = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolve(value)]));
const getPath = (data: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], data);

type Recorded = { code: number; body: unknown };
const recorded = new Map<RequestDef, Recorded>();

console.log("Running the collection:");
for (const folder of folders) {
  for (const def of folder.items) {
    const method = def.method.toLowerCase() as "get" | "post" | "patch" | "delete";
    let call = request(app)[method](`/api/v1${resolve(def.path)}`);
    if (def.query) call = call.query(resolveAll(def.query));
    if (def.auth) call = call.set("Authorization", `Bearer ${vars.get(def.auth) ?? ""}`);
    if (def.json !== undefined) call = call.send(JSON.parse(resolve(JSON.stringify(def.json))));
    else if (def.rawBody !== undefined) call = call.type("json").send(def.rawBody);
    else if (def.form) call = call.type("form").send(resolveAll(def.form));

    const res = await call;
    const codes = Array.isArray(def.expect) ? def.expect : [def.expect];
    const allowed = def.skipRecording ? codes : codes.slice(0, 1);
    if (!allowed.includes(res.status)) {
      throw new Error(
        `"${def.name}": expected ${allowed.join("/")}, got ${res.status}\n${res.text}`,
      );
    }
    if (def.save && res.status < 300) {
      for (const [variable, path] of Object.entries(def.save)) {
        vars.set(variable, String(getPath(res.body.data, path)));
      }
    }
    if (!def.skipRecording) recorded.set(def, { code: res.status, body: res.body });
    console.log(`  ${res.status}  ${def.method.padEnd(6)} ${def.path.padEnd(42)} ${def.name}`);
  }
}

await prisma.$disconnect();
globalThis.fetch = realFetch;

// ── 4. Build the Postman files ────────────────────────────────────────────────────────
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
/** Real tokens never go into the docs. */
function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return JWT.test(value) ? `${value.split(".")[0]}.<redacted>.<redacted>` : value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  }
  return value;
}

const auth = (token?: TokenVar) =>
  token
    ? { type: "bearer", bearer: [{ key: "token", value: `{{${token}}}`, type: "string" }] }
    : { type: "noauth" };

function postmanUrl(def: RequestDef) {
  const query = Object.entries(def.query ?? {}).map(([key, value]) => ({ key, value }));
  const search = query.length
    ? `?${query.map(({ key, value }) => `${key}=${value}`).join("&")}`
    : "";
  return {
    raw: `{{baseUrl}}${def.path}${search}`,
    host: ["{{baseUrl}}"],
    path: def.path.split("/").filter(Boolean),
    ...(query.length ? { query } : {}),
  };
}

function postmanBody(def: RequestDef) {
  if (def.json !== undefined) {
    return {
      mode: "raw",
      raw: JSON.stringify(def.json, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  if (def.rawBody !== undefined) {
    return { mode: "raw", raw: def.rawBody, options: { raw: { language: "json" } } };
  }
  if (def.form) {
    return {
      mode: "urlencoded",
      urlencoded: Object.entries(def.form).map(([key, value]) => ({ key, value, type: "text" })),
    };
  }
  return undefined;
}

function postmanRequest(def: RequestDef) {
  const body = postmanBody(def);
  const hasJson = def.json !== undefined || def.rawBody !== undefined;
  return {
    method: def.method,
    auth: auth(def.auth),
    header: hasJson ? [{ key: "Content-Type", value: "application/json" }] : [],
    url: postmanUrl(def),
    ...(body ? { body } : {}),
  };
}

function testScript(def: RequestDef): string[] {
  const codes = Array.isArray(def.expect) ? def.expect : [def.expect];
  const lines =
    codes.length === 1
      ? [`pm.test("Status is ${codes[0]}", () => pm.response.to.have.status(${codes[0]}));`]
      : [
          `pm.test("Status is ${codes.join(" or ")}", () => pm.expect([${codes.join(", ")}]).to.include(pm.response.code));`,
        ];
  if (!def.notJson) {
    lines.push(
      'pm.test("Standard response format", () => {',
      "  const body = pm.response.json();",
      '  pm.expect(body.success).to.be.a("boolean");',
      '  pm.expect(body.message).to.be.a("string");',
      '  if (body.success) pm.expect(body).to.have.property("data");',
      '  else pm.expect(body.errors).to.be.an("array");',
      "});",
    );
  }
  if (def.save) {
    lines.push("if (pm.response.code < 300) {", "  const data = pm.response.json().data;");
    for (const [variable, path] of Object.entries(def.save)) {
      lines.push(`  pm.collectionVariables.set("${variable}", data.${path});`);
    }
    lines.push("}");
  }
  return lines;
}

function example(
  def: RequestDef,
  name: string,
  code: number,
  body: unknown,
  header: Array<{ key: string; value: string }> = [JSON_HEADER],
) {
  return {
    name,
    originalRequest: postmanRequest(def),
    status: STATUS_CODES[code] ?? "",
    code,
    _postman_previewlanguage: body === "" ? "text" : "json",
    header,
    cookie: [],
    body: body === "" ? "" : JSON.stringify(redact(body), null, 2),
  };
}

const loginExample = recorded.get(
  folders
    .flatMap((folder) => folder.items)
    .find((def) => def.name === "Login as MANAGER") as RequestDef,
);

function examplesFor(def: RequestDef) {
  const list = [];
  const rec = recorded.get(def);
  if (rec)
    list.push(example(def, `${rec.code} ${STATUS_CODES[rec.code] ?? ""}`, rec.code, rec.body));

  if (def.name === "Google login (open in a browser)") {
    list.push(
      example(def, "302 Found (redirect to Google)", 302, "", [
        {
          key: "Location",
          value:
            "https://accounts.google.com/o/oauth2/v2/auth?access_type=online&scope=openid%20email%20profile&state=9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f60&prompt=select_account&response_type=code&client_id=YOUR_CLIENT_ID.apps.googleusercontent.com&redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fapi%2Fv1%2Fauth%2Fgoogle%2Fcallback",
        },
        {
          key: "Set-Cookie",
          value:
            "tasknest_oauth_state=9f2c4e1a7b3d5c6e8f0a1b2c3d4e5f60.MANAGER; Max-Age=600; Path=/api/v1/auth/google; HttpOnly; SameSite=Lax",
        },
      ]),
    );
  }
  if (def.name === "Google login callback" && loginExample) {
    const body = {
      ...(loginExample.body as Record<string, unknown>),
      message: "Logged in with Google",
    };
    list.push(example(def, "200 OK (after a real Google sign-in)", 200, body));
  }
  return list;
}

const savedVariables = [
  ...new Set(
    folders.flatMap((folder) => folder.items.flatMap((def) => Object.keys(def.save ?? {}))),
  ),
];

const collection = {
  info: {
    name: "TaskNest API",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    description: [
      "TaskNest – Project Management SaaS REST API (B7A6). Roles: **ADMIN**, **MANAGER**, **MEMBER**.",
      "",
      "**Run it:** pick the environment (local or production), then use *Run collection*. The requests are in order: logins save tokens and created ids into collection variables, so later requests use them automatically.",
      "",
      "**Auth:** `Authorization: Bearer <accessToken>` (set per request from the saved tokens).",
      "",
      "**Responses:** success `{ success: true, message, data, meta? }` · error `{ success: false, message, errors: [{ field, message }] }`.",
      "",
      "**Demo accounts:** admin@tasknest.com / Admin@12345 · manager@tasknest.com / Manager@123 · rahim@tasknest.com / Member@123 · karim@tasknest.com / Member@123.",
      "",
      "Every request has a saved example response recorded from the real API (tokens redacted; SSLCommerz simulated for the payment examples).",
    ].join("\n"),
  },
  auth: { type: "noauth" },
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          "// A due date 30 days from now, used when creating projects and tasks.",
          'pm.collectionVariables.set("dueDate", new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));',
        ],
      },
    },
  ],
  variable: [
    { key: "baseUrl", value: LOCAL_BASE_URL, type: "string" },
    { key: "valId", value: "paste-the-val_id-sent-by-sslcommerz", type: "string" },
    { key: "dueDate", value: "", type: "string" },
    ...savedVariables.map((key) => ({ key, value: "", type: "string" })),
  ],
  item: folders.map((folder) => ({
    name: folder.name,
    description: folder.description,
    item: folder.items.map((def) => ({
      name: def.name,
      event: [{ listen: "test", script: { type: "text/javascript", exec: testScript(def) } }],
      ...(def.notJson ? { protocolProfileBehavior: { followRedirects: false } } : {}),
      request: { ...postmanRequest(def), description: def.description },
      response: examplesFor(def),
    })),
  })),
};

const environmentFor = (name: string, baseUrl: string) => ({
  name,
  values: [{ key: "baseUrl", value: baseUrl, type: "default", enabled: true }],
  _postman_variable_scope: "environment",
});

writeFileSync(COLLECTION_FILE, `${JSON.stringify(collection, null, 2)}\n`);
writeFileSync(
  ENVIRONMENT_FILE,
  `${JSON.stringify(environmentFor("TaskNest – Local", LOCAL_BASE_URL), null, 2)}\n`,
);
writeFileSync(
  PRODUCTION_ENVIRONMENT_FILE,
  `${JSON.stringify(environmentFor("TaskNest – Production", PRODUCTION_BASE_URL), null, 2)}\n`,
);

const requestCount = folders.reduce((total, folder) => total + folder.items.length, 0);
const exampleCount = collection.item.reduce(
  (total, folder) => total + folder.item.reduce((sum, item) => sum + item.response.length, 0),
  0,
);
console.log(`\nWrote ${COLLECTION_FILE} (${requestCount} requests, ${exampleCount} examples)`);
console.log(`Wrote ${ENVIRONMENT_FILE} and ${PRODUCTION_ENVIRONMENT_FILE}`);
