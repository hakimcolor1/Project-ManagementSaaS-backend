import type { Request, Response } from "express";
import { getCurrentUser } from "../../middlewares/auth.js";
import { sendResponse } from "../../utils/sendResponse.js";
import * as paymentsService from "./payments.service.js";
import type {
  CloseCallbackBody,
  IpnBody,
  ListPaymentsQuery,
  SuccessCallbackBody,
} from "./payments.validation.js";

/** POST /api/v1/payments/initiate */
export async function initiatePayment(req: Request, res: Response) {
  const result = await paymentsService.initiatePayment(getCurrentUser(req));
  sendResponse(res, {
    statusCode: 201,
    message: "Payment started. Open paymentUrl in a browser to pay.",
    data: result,
  });
}

/** POST /api/v1/payments/success (SSLCommerz redirects the browser here) */
export async function paymentSuccess(req: Request, res: Response) {
  const { tran_id, val_id } = req.body as SuccessCallbackBody;
  const result = await paymentsService.confirmPayment(tran_id, val_id, "success");
  sendResponse(res, {
    message: result.alreadyProcessed
      ? "This payment was already confirmed"
      : "Payment successful. Your PRO plan is active.",
    data: result,
  });
}

/** The message tells the truth even when the payment was already closed or paid. */
function closeMessage(status: string, requested: "FAILED" | "CANCELLED"): string {
  if (status !== requested) {
    return `Nothing changed: this payment is already ${status}`;
  }
  return requested === "FAILED" ? "Payment failed. No money was taken." : "Payment cancelled";
}

/** POST /api/v1/payments/fail */
export async function paymentFail(req: Request, res: Response) {
  const payment = await paymentsService.closeFromGateway(
    (req.body as CloseCallbackBody).tran_id,
    "FAILED",
  );
  sendResponse(res, { message: closeMessage(payment.status, "FAILED"), data: payment });
}

/** POST /api/v1/payments/cancel */
export async function paymentCancel(req: Request, res: Response) {
  const payment = await paymentsService.closeFromGateway(
    (req.body as CloseCallbackBody).tran_id,
    "CANCELLED",
  );
  sendResponse(res, { message: closeMessage(payment.status, "CANCELLED"), data: payment });
}

/** POST /api/v1/payments/ipn (server-to-server notification from SSLCommerz) */
export async function paymentIpn(req: Request, res: Response) {
  const result = await paymentsService.handleIpn(req.body as IpnBody);
  sendResponse(res, { message: "IPN processed", data: result });
}

/** GET /api/v1/payments */
export async function listPayments(req: Request, res: Response) {
  const { payments, meta } = await paymentsService.listPayments(
    getCurrentUser(req),
    req.query as unknown as ListPaymentsQuery,
  );
  sendResponse(res, { message: "Payments retrieved", data: payments, meta });
}

/** GET /api/v1/payments/:id */
export async function getPayment(req: Request, res: Response) {
  const payment = await paymentsService.getPayment(getCurrentUser(req), String(req.params.id));
  sendResponse(res, { message: "Payment retrieved", data: payment });
}
