import express, { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  getPayment,
  initiatePayment,
  listPayments,
  paymentCancel,
  paymentFail,
  paymentIpn,
  paymentSuccess,
} from "./payments.controller.js";
import {
  closeCallbackSchema,
  initiatePaymentSchema,
  ipnSchema,
  listPaymentsSchema,
  paymentParamsSchema,
  successCallbackSchema,
} from "./payments.validation.js";

export const paymentRoutes = Router();

// SSLCommerz posts its callbacks as HTML forms (application/x-www-form-urlencoded).
const formBody = express.urlencoded({ extended: false, limit: "100kb" });

paymentRoutes.post(
  "/initiate",
  auth,
  authorize("MANAGER"),
  validate(initiatePaymentSchema),
  initiatePayment,
);

// Public: called by SSLCommerz / the customer's browser. Trusted only after server-side validation.
paymentRoutes.post("/success", formBody, validate(successCallbackSchema), paymentSuccess);
paymentRoutes.post("/fail", formBody, validate(closeCallbackSchema), paymentFail);
paymentRoutes.post("/cancel", formBody, validate(closeCallbackSchema), paymentCancel);
paymentRoutes.post("/ipn", formBody, validate(ipnSchema), paymentIpn);

paymentRoutes.get(
  "/",
  auth,
  authorize("MANAGER", "ADMIN"),
  validate(listPaymentsSchema),
  listPayments,
);
paymentRoutes.get(
  "/:id",
  auth,
  authorize("MANAGER", "ADMIN"),
  validate(paymentParamsSchema),
  getPayment,
);
