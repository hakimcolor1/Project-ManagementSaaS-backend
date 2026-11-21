import { randomBytes } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import { lockRow, prisma, TX_OPTIONS } from "../../lib/prisma.js";
import {
  assertGatewayConfigured,
  createPaymentSession,
  validateWithGateway,
} from "../../lib/sslcommerz.js";
import type { AuthUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { writeAuditLog } from "../../utils/audit.js";
import { buildMeta, toSkipTake } from "../../utils/pagination.js";
import { getEffectivePlan, PRO_PLAN } from "../../utils/plan.js";
import type { IpnBody, ListPaymentsQuery } from "./payments.validation.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const paymentSelect = {
  id: true,
  plan: true,
  amount: true,
  currency: true,
  tranId: true,
  status: true,
  cardType: true,
  bankTranId: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

/** Money leaves the API as a string with two decimals ("500.00"). */
function toPayment(row: PaymentRow) {
  return { ...row, amount: row.amount.toFixed(2) };
}

/** "TN-<timestamp>-<random>": unique and inside SSLCommerz's 30-character limit. */
function newTranId(): string {
  return `TN-${Date.now()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Compares money in paisa (whole numbers), never as floating point. */
function toPaisa(amount: unknown): number {
  return Math.round(Number(String(amount)) * 100);
}

async function findPaymentByTranId(tranId: string) {
  const payment = await prisma.payment.findUnique({
    where: { tranId },
    select: { ...paymentSelect, userId: true },
  });
  if (!payment) {
    throw new AppError(404, "Payment not found");
  }
  return payment;
}

async function getPaymentRow(id: string) {
  return prisma.payment.findUniqueOrThrow({ where: { id }, select: paymentSelect });
}

/** PENDING → FAILED / CANCELLED (+ audit log). Any other status is left alone. */
async function closePayment(
  paymentId: string,
  status: "FAILED" | "CANCELLED",
  details: Prisma.InputJsonObject,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status, gatewayData: details },
    });
    if (count === 1) {
      await writeAuditLog(tx, {
        actorId: null, // the gateway, not a user
        action: status === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_CANCELLED",
        entityType: "PAYMENT",
        entityId: paymentId,
        metadata: details,
      });
    }
  }, TX_OPTIONS);
}

/** POST /payments/initiate – saves a PENDING payment and opens an SSLCommerz session. */
export async function initiatePayment(user: AuthUser) {
  assertGatewayConfigured();

  const payment = await prisma.payment.create({
    data: {
      userId: user.id,
      plan: "PRO",
      amount: PRO_PLAN.price,
      currency: PRO_PLAN.currency,
      tranId: newTranId(),
    },
    select: paymentSelect,
  });

  try {
    const session = await createPaymentSession({
      tranId: payment.tranId,
      amount: PRO_PLAN.price,
      currency: PRO_PLAN.currency,
      productName: `TaskNest PRO plan (${PRO_PLAN.durationDays} days)`,
      customer: { name: user.name, email: user.email },
    });
    return { payment: toPayment(payment), paymentUrl: session.gatewayUrl };
  } catch (error) {
    const reason = error instanceof AppError ? error.message : "Payment gateway error";
    await closePayment(payment.id, "FAILED", { reason, source: "initiate" });
    throw error;
  }
}

/**
 * Success callback and IPN. The payment becomes PAID only after the SSLCommerz validation API
 * confirms it (status, tran_id, amount, currency). Safe to call many times: the plan is
 * extended only once per payment, even if the success callback and the IPN arrive together.
 */
export async function confirmPayment(tranId: string, valId: string, source: "success" | "ipn") {
  const payment = await findPaymentByTranId(tranId);
  if (payment.status === "PAID") {
    return { payment: toPayment(payment), alreadyProcessed: true, planExpiresAt: null };
  }

  const validation = await validateWithGateway(valId);
  if (validation.status !== "VALID" && validation.status !== "VALIDATED") {
    // Fake or unknown val_id: change nothing, the real callback can still arrive.
    throw new AppError(400, "The payment could not be verified with the payment gateway");
  }
  if (validation.tran_id !== payment.tranId) {
    throw new AppError(400, "This payment confirmation belongs to a different transaction");
  }

  const paidAmount = validation.currency_amount ?? validation.amount;
  const paidCurrency = validation.currency_type ?? validation.currency;
  if (toPaisa(paidAmount) !== toPaisa(payment.amount) || paidCurrency !== payment.currency) {
    await closePayment(payment.id, "FAILED", {
      reason: "Paid amount or currency does not match the plan price",
      paidAmount: paidAmount ?? null,
      paidCurrency: paidCurrency ?? null,
      valId,
      source,
    });
    throw new AppError(
      400,
      "The paid amount does not match the plan price. The payment was marked as FAILED.",
    );
  }

  const planExpiresAt = await prisma.$transaction(async (tx) => {
    // Lock the manager first: two payments of the same manager extend the plan one after the other.
    await lockRow(tx, "users", payment.userId);

    // FAILED/CANCELLED can still become PAID: the gateway confirmed that the money arrived.
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: "PAID" } },
      data: {
        status: "PAID",
        valId,
        bankTranId: validation.bank_tran_id ?? null,
        cardType: validation.card_type ?? null,
        gatewayData: validation as Prisma.InputJsonObject,
        paidAt: new Date(),
      },
    });
    if (count === 0) {
      return null; // another callback was faster
    }

    const owner = await tx.user.findUniqueOrThrow({
      where: { id: payment.userId },
      select: { plan: true, planExpiresAt: true },
    });
    const now = new Date();
    const startsFrom =
      getEffectivePlan(owner, now) === "PRO" && owner.planExpiresAt ? owner.planExpiresAt : now;
    const expiresAt = new Date(startsFrom.getTime() + PRO_PLAN.durationDays * DAY_MS);

    await tx.user.update({
      where: { id: payment.userId },
      data: { plan: "PRO", planExpiresAt: expiresAt },
    });
    await writeAuditLog(tx, {
      actorId: payment.userId,
      action: "PAYMENT_PAID",
      entityType: "PAYMENT",
      entityId: payment.id,
      metadata: {
        tranId,
        amount: PRO_PLAN.price,
        source,
        planExpiresAt: expiresAt.toISOString(),
      },
    });
    return expiresAt;
  }, TX_OPTIONS);

  return {
    payment: toPayment(await getPaymentRow(payment.id)),
    alreadyProcessed: planExpiresAt === null,
    planExpiresAt,
  };
}

/** Fail / cancel callbacks: PENDING → FAILED / CANCELLED. They can never set PAID. */
export async function closeFromGateway(tranId: string, status: "FAILED" | "CANCELLED") {
  const payment = await findPaymentByTranId(tranId);
  await closePayment(payment.id, status, {
    reason:
      status === "FAILED" ? "The gateway reported a failed payment" : "Cancelled by the customer",
    source: status === "FAILED" ? "fail-callback" : "cancel-callback",
  });
  return toPayment(await getPaymentRow(payment.id));
}

/** IPN: VALID → same check as the success callback; FAILED/CANCELLED/EXPIRED → closed. */
export async function handleIpn(body: IpnBody) {
  const status = body.status?.toUpperCase();
  if (body.val_id && (!status || status === "VALID" || status === "VALIDATED")) {
    return confirmPayment(body.tran_id, body.val_id, "ipn");
  }
  const closed = await closeFromGateway(
    body.tran_id,
    status === "CANCELLED" ? "CANCELLED" : "FAILED",
  );
  return { payment: closed, alreadyProcessed: false, planExpiresAt: null };
}

/** Managers see their own payments; admins see all (optionally of one user). */
export async function listPayments(user: AuthUser, query: ListPaymentsQuery) {
  const where: Prisma.PaymentWhereInput = {
    ...(user.role === "ADMIN"
      ? query.userId
        ? { userId: query.userId }
        : {}
      : { userId: user.id }),
    ...(query.status ? { status: query.status } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      select: paymentSelect,
      orderBy: { createdAt: "desc" },
      ...toSkipTake(query.page, query.limit),
    }),
    prisma.payment.count({ where }),
  ]);
  return { payments: rows.map(toPayment), meta: buildMeta(query.page, query.limit, total) };
}

/** A manager can only open their own payment (others → 404); an admin can open any. */
export async function getPayment(user: AuthUser, paymentId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, ...(user.role === "ADMIN" ? {} : { userId: user.id }) },
    select: paymentSelect,
  });
  if (!payment) {
    throw new AppError(404, "Payment not found");
  }
  return toPayment(payment);
}
