import { z } from "zod";
import { paginationFields } from "../../utils/pagination.js";
import { uuidField } from "../../utils/validators.js";

/** The amount is never sent by the client: it comes from the server's plan price (BR-18). */
export const initiatePaymentSchema = z.object({
  body: z.strictObject({
    plan: z.literal("PRO", { error: 'plan must be "PRO"' }).default("PRO"),
  }),
});

const tranId = z
  .string({ error: "tran_id is required" })
  .trim()
  .min(1, "tran_id is required")
  .max(64, "tran_id is too long");

const valId = z
  .string({ error: "val_id is required" })
  .trim()
  .min(1, "val_id is required")
  .max(100, "val_id is too long");

// SSLCommerz posts many more fields; only the ones TaskNest uses are kept (others are dropped).
export const successCallbackSchema = z.object({
  body: z.object({ tran_id: tranId, val_id: valId }),
});

export const closeCallbackSchema = z.object({
  body: z.object({ tran_id: tranId }),
});

export const ipnSchema = z.object({
  body: z.object({
    tran_id: tranId,
    val_id: valId.optional(),
    status: z.string().trim().max(50).optional(),
  }),
});

export const listPaymentsSchema = z.object({
  query: z.strictObject({
    ...paginationFields,
    status: z
      .enum(["PENDING", "PAID", "FAILED", "CANCELLED"], {
        error: "status must be PENDING, PAID, FAILED or CANCELLED",
      })
      .optional(),
    /** Admin only: payments of one user. Ignored for managers. */
    userId: uuidField("userId").optional(),
  }),
});

export const paymentParamsSchema = z.object({
  params: z.strictObject({ id: uuidField("Payment id") }),
});

export type SuccessCallbackBody = z.infer<typeof successCallbackSchema>["body"];
export type CloseCallbackBody = z.infer<typeof closeCallbackSchema>["body"];
export type IpnBody = z.infer<typeof ipnSchema>["body"];
export type ListPaymentsQuery = z.infer<typeof listPaymentsSchema>["query"];
