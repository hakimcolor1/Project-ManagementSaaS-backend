import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetDatabase } from "./helpers/db.js";
import { api, bearer, loginAs } from "./helpers/factory.js";
import { mockGateway, validPayment } from "./helpers/gateway.js";

beforeAll(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

type StartedPayment = {
  payment: { id: string; tranId: string; status: string; amount: string; currency: string };
  paymentUrl: string;
};

async function startPayment(token: string): Promise<StartedPayment> {
  const res = await api().post("/api/v1/payments/initiate").set(bearer(token)).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as StartedPayment;
}

/** SSLCommerz posts its callbacks as a form (application/x-www-form-urlencoded). */
function callback(path: "success" | "fail" | "cancel" | "ipn", fields: Record<string, string>) {
  return api().post(`/api/v1/payments/${path}`).type("form").send(fields);
}

async function planOf(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
}

describe("POST /api/v1/payments/initiate", () => {
  it("starts a 500.00 BDT PRO payment and returns the SSLCommerz page", async () => {
    const fetchSpy = mockGateway();
    const manager = await loginAs("MANAGER");

    const { payment, paymentUrl } = await startPayment(manager.accessToken);

    expect(payment).toMatchObject({ status: "PENDING", amount: "500.00", currency: "BDT" });
    expect(payment.tranId).toMatch(/^TN-\d+-[0-9A-F]{6}$/);
    expect(payment.tranId.length).toBeLessThanOrEqual(30);
    expect(paymentUrl).toContain("sslcommerz.com");

    // The amount sent to the gateway comes from the server.
    const form = new URLSearchParams(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(form.get("total_amount")).toBe("500.00");
    expect(form.get("currency")).toBe("BDT");
    expect(form.get("tran_id")).toBe(payment.tranId);
    expect(form.get("success_url")).toMatch(/\/api\/v1\/payments\/success$/);
    expect(form.get("ipn_url")).toMatch(/\/api\/v1\/payments\/ipn$/);
  });

  it("never accepts an amount from the client (400)", async () => {
    mockGateway();
    const manager = await loginAs("MANAGER");
    const res = await api()
      .post("/api/v1/payments/initiate")
      .set(bearer(manager.accessToken))
      .send({ amount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "amount", message: 'Unknown field "amount"' }]);
  });

  it("is for managers only (403 for members and admins)", async () => {
    mockGateway();
    for (const role of ["MEMBER", "ADMIN"] as const) {
      const { accessToken } = await loginAs(role);
      const res = await api().post("/api/v1/payments/initiate").set(bearer(accessToken)).send({});
      expect(res.status).toBe(403);
    }
  });

  it("marks the payment FAILED when the gateway refuses (502)", async () => {
    mockGateway({ session: { status: "FAILED", failedreason: "Store is de-active" } });
    const manager = await loginAs("MANAGER");

    const res = await api()
      .post("/api/v1/payments/initiate")
      .set(bearer(manager.accessToken))
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.message).toContain("Store is de-active");
    const payments = await prisma.payment.findMany({ where: { userId: manager.user.id } });
    expect(payments.map((p) => p.status)).toEqual(["FAILED"]);
  });

  it("answers 502 when the gateway cannot be reached", async () => {
    mockGateway({ session: "network-error" });
    const manager = await loginAs("MANAGER");
    const res = await api()
      .post("/api/v1/payments/initiate")
      .set(bearer(manager.accessToken))
      .send({});
    expect(res.status).toBe(502);
  });
});

describe("SSLCommerz success callback", () => {
  it("validates with the gateway, marks PAID and gives the manager 30 days of PRO", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);
    validations.set("VAL-OK", validPayment(payment.tranId));

    const before = Date.now();
    const res = await callback("success", {
      tran_id: payment.tranId,
      val_id: "VAL-OK",
      status: "VALID",
      amount: "500.00",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.alreadyProcessed).toBe(false);
    expect(res.body.data.payment).toMatchObject({
      id: payment.id,
      status: "PAID",
      cardType: "VISA-Dutch Bangla",
    });

    const plan = await planOf(manager.user.id);
    expect(plan.plan).toBe("PRO");
    const expires = plan.planExpiresAt?.getTime() ?? 0;
    expect(expires).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + THIRTY_DAYS_MS + 1000);

    const me = await api().get("/api/v1/users/me").set(bearer(manager.accessToken));
    expect(me.body.data.subscription).toMatchObject({
      plan: "PRO",
      limits: { maxActiveProjects: null, maxMembersPerProject: null },
    });

    const audit = await prisma.auditLog.findMany({
      where: { entityId: payment.id, action: "PAYMENT_PAID" },
    });
    expect(audit).toHaveLength(1);
  });

  it("is idempotent: a replayed success and a later IPN do not extend the plan again", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);
    validations.set("VAL-OK", validPayment(payment.tranId));

    await callback("success", { tran_id: payment.tranId, val_id: "VAL-OK" });
    const firstExpiry = (await planOf(manager.user.id)).planExpiresAt;

    const replay = await callback("success", { tran_id: payment.tranId, val_id: "VAL-OK" });
    const ipn = await callback("ipn", {
      tran_id: payment.tranId,
      val_id: "VAL-OK",
      status: "VALID",
    });

    expect(replay.status).toBe(200);
    expect(replay.body.data.alreadyProcessed).toBe(true);
    expect(ipn.status).toBe(200);
    expect(ipn.body.data.alreadyProcessed).toBe(true);
    expect((await planOf(manager.user.id)).planExpiresAt).toEqual(firstExpiry);
  });

  it("activates only once when the success callback and the IPN arrive at the same time", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);
    validations.set("VAL-OK", validPayment(payment.tranId));

    const before = Date.now();
    const [success, ipn] = await Promise.all([
      callback("success", { tran_id: payment.tranId, val_id: "VAL-OK" }),
      callback("ipn", { tran_id: payment.tranId, val_id: "VAL-OK", status: "VALID" }),
    ]);

    expect(success.status).toBe(200);
    expect(ipn.status).toBe(200);
    expect([success.body.data.alreadyProcessed, ipn.body.data.alreadyProcessed].sort()).toEqual([
      false,
      true,
    ]);

    // 30 days, not 60.
    const expires = (await planOf(manager.user.id)).planExpiresAt?.getTime() ?? 0;
    expect(expires).toBeLessThanOrEqual(Date.now() + THIRTY_DAYS_MS + 1000);
    expect(expires).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - 1000);
    const paidLogs = await prisma.auditLog.count({
      where: { entityId: payment.id, action: "PAYMENT_PAID" },
    });
    expect(paidLogs).toBe(1);
  });

  it("adds 30 days to the current end date when PRO is still active", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const currentEnd = new Date(Date.now() + 10 * DAY_MS);
    const manager = await loginAs("MANAGER", { plan: "PRO", planExpiresAt: currentEnd });
    const { payment } = await startPayment(manager.accessToken);
    validations.set("VAL-OK", validPayment(payment.tranId));

    await callback("success", { tran_id: payment.tranId, val_id: "VAL-OK" });

    const plan = await planOf(manager.user.id);
    expect(plan.planExpiresAt?.getTime()).toBe(currentEnd.getTime() + THIRTY_DAYS_MS);
  });

  it("changes nothing when the gateway does not confirm the val_id (400)", async () => {
    mockGateway({ validations: new Map() });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);

    const res = await callback("success", { tran_id: payment.tranId, val_id: "FAKE-VAL" });

    expect(res.status).toBe(400);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
      status: "PENDING",
    });
    expect((await planOf(manager.user.id)).plan).toBe("FREE");
  });

  it("refuses a val_id that belongs to another transaction (400)", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);
    validations.set("VAL-OTHER", validPayment("TN-SOMEONE-ELSE"));

    const res = await callback("success", { tran_id: payment.tranId, val_id: "VAL-OTHER" });

    expect(res.status).toBe(400);
    expect((await planOf(manager.user.id)).plan).toBe("FREE");
  });

  it("marks the payment FAILED when the paid amount is wrong", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);
    validations.set(
      "VAL-CHEAP",
      validPayment(payment.tranId, { amount: "10.00", currency_amount: "10.00" }),
    );

    const res = await callback("success", { tran_id: payment.tranId, val_id: "VAL-CHEAP" });

    expect(res.status).toBe(400);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.status).toBe("FAILED");
    expect((await planOf(manager.user.id)).plan).toBe("FREE");
    const failedLogs = await prisma.auditLog.count({
      where: { entityId: payment.id, action: "PAYMENT_FAILED" },
    });
    expect(failedLogs).toBe(1);
  });

  it("answers 404 for an unknown transaction and 400 without tran_id", async () => {
    mockGateway();
    const unknown = await callback("success", { tran_id: "TN-NOPE", val_id: "VAL-X" });
    expect(unknown.status).toBe(404);
    const missing = await callback("success", { val_id: "VAL-X" });
    expect(missing.status).toBe(400);
  });
});

describe("SSLCommerz fail / cancel / IPN", () => {
  it("fail → FAILED and cancel → CANCELLED, with one audit log each", async () => {
    mockGateway();
    const manager = await loginAs("MANAGER");
    const first = await startPayment(manager.accessToken);
    const second = await startPayment(manager.accessToken);

    const failed = await callback("fail", { tran_id: first.payment.tranId, status: "FAILED" });
    const cancelled = await callback("cancel", { tran_id: second.payment.tranId });
    await callback("fail", { tran_id: first.payment.tranId }); // replay

    expect(failed.status).toBe(200);
    expect(failed.body.data.status).toBe("FAILED");
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect(
      await prisma.auditLog.count({
        where: { entityId: first.payment.id, action: "PAYMENT_FAILED" },
      }),
    ).toBe(1);
    expect((await planOf(manager.user.id)).plan).toBe("FREE");
  });

  it("a gateway-confirmed payment still becomes PAID after a (possibly fake) cancel", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);

    await callback("cancel", { tran_id: payment.tranId });
    validations.set("VAL-OK", validPayment(payment.tranId));
    const res = await callback("success", { tran_id: payment.tranId, val_id: "VAL-OK" });

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe("PAID");
    expect((await planOf(manager.user.id)).plan).toBe("PRO");
  });

  it("an IPN with status FAILED closes the payment", async () => {
    mockGateway();
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);

    const res = await callback("ipn", { tran_id: payment.tranId, status: "FAILED" });

    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe("FAILED");
  });

  it("a fail callback for a paid payment changes nothing and says so", async () => {
    const validations = new Map();
    mockGateway({ validations });
    const manager = await loginAs("MANAGER");
    const { payment } = await startPayment(manager.accessToken);
    validations.set("VAL-OK", validPayment(payment.tranId));
    await callback("success", { tran_id: payment.tranId, val_id: "VAL-OK" });

    const res = await callback("fail", { tran_id: payment.tranId, status: "FAILED" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Nothing changed: this payment is already PAID");
    expect(res.body.data.status).toBe("PAID");
    expect((await planOf(manager.user.id)).plan).toBe("PRO");
  });
});

describe("GET /api/v1/payments", () => {
  it("managers see only their own payments; admins see all; members get 403", async () => {
    await resetDatabase();
    mockGateway();
    const managerA = await loginAs("MANAGER");
    const managerB = await loginAs("MANAGER");
    const admin = await loginAs("ADMIN");
    const member = await loginAs("MEMBER");
    await startPayment(managerA.accessToken);
    await startPayment(managerA.accessToken);
    const bPayment = await startPayment(managerB.accessToken);

    const own = await api().get("/api/v1/payments").set(bearer(managerA.accessToken));
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(2);
    expect(own.body.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });

    // A manager cannot read another manager's payments, even with ?userId=
    const sneaky = await api()
      .get(`/api/v1/payments?userId=${managerB.user.id}`)
      .set(bearer(managerA.accessToken));
    expect(sneaky.body.data).toHaveLength(2);

    const all = await api().get("/api/v1/payments?status=PENDING").set(bearer(admin.accessToken));
    expect(all.body.meta.total).toBe(3);
    const onlyB = await api()
      .get(`/api/v1/payments?userId=${managerB.user.id}`)
      .set(bearer(admin.accessToken));
    expect(onlyB.body.data.map((p: { id: string }) => p.id)).toEqual([bPayment.payment.id]);

    const forbidden = await api().get("/api/v1/payments").set(bearer(member.accessToken));
    expect(forbidden.status).toBe(403);
  });

  it("GET /payments/:id: own → 200, someone else's → 404, admin → 200, bad id → 400", async () => {
    mockGateway();
    const managerA = await loginAs("MANAGER");
    const managerB = await loginAs("MANAGER");
    const admin = await loginAs("ADMIN");
    const { payment } = await startPayment(managerB.accessToken);

    const own = await api().get(`/api/v1/payments/${payment.id}`).set(bearer(managerB.accessToken));
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ id: payment.id, amount: "500.00", status: "PENDING" });

    const other = await api()
      .get(`/api/v1/payments/${payment.id}`)
      .set(bearer(managerA.accessToken));
    expect(other.status).toBe(404);

    const byAdmin = await api()
      .get(`/api/v1/payments/${payment.id}`)
      .set(bearer(admin.accessToken));
    expect(byAdmin.status).toBe(200);

    const badId = await api().get("/api/v1/payments/not-a-uuid").set(bearer(admin.accessToken));
    expect(badId.status).toBe(400);
  });
});
