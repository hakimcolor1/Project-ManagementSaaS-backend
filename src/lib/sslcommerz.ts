import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

/**
 * SSLCommerz (sandbox unless SSLC_IS_LIVE=true), called over plain HTTPS.
 * Docs: https://developer.sslcommerz.com/doc/v4/
 */
const BASE_URL = env.SSLC_IS_LIVE
  ? "https://securepay.sslcommerz.com"
  : "https://sandbox.sslcommerz.com";
const SESSION_URL = `${BASE_URL}/gwprocess/v4/api.php`;
const VALIDATION_URL = `${BASE_URL}/validator/api/validationserverAPI.php`;
const TIMEOUT_MS = 15_000;

export const PAYMENT_CALLBACK_BASE = "/api/v1/payments";

function getCredentials() {
  if (!env.SSLC_STORE_ID || !env.SSLC_STORE_PASSWORD) {
    throw new AppError(503, "The payment gateway is not configured on this server");
  }
  return { storeId: env.SSLC_STORE_ID, storePassword: env.SSLC_STORE_PASSWORD };
}

/** Throws 503 before anything is saved when the store credentials are missing. */
export function assertGatewayConfigured(): void {
  getCredentials();
}

export type PaymentSessionInput = {
  tranId: string;
  amount: string;
  currency: string;
  productName: string;
  customer: { name: string; email: string };
};

type SessionResponse = {
  status?: string;
  failedreason?: string;
  GatewayPageURL?: string;
  sessionkey?: string;
};

/** Asks SSLCommerz for a hosted payment page and returns its URL. */
export async function createPaymentSession(input: PaymentSessionInput): Promise<{
  gatewayUrl: string;
  sessionKey: string | null;
}> {
  const { storeId, storePassword } = getCredentials();
  const callbackUrl = (path: string) => `${env.APP_URL}${PAYMENT_CALLBACK_BASE}/${path}`;

  const form = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePassword,
    total_amount: input.amount,
    currency: input.currency,
    tran_id: input.tranId,
    success_url: callbackUrl("success"),
    fail_url: callbackUrl("fail"),
    cancel_url: callbackUrl("cancel"),
    ipn_url: callbackUrl("ipn"),
    product_name: input.productName,
    product_category: "Subscription",
    product_profile: "non-physical-goods",
    num_of_item: "1",
    shipping_method: "NO",
    cus_name: input.customer.name,
    cus_email: input.customer.email,
    // Required by SSLCommerz; TaskNest does not collect addresses or phone numbers.
    cus_add1: "N/A",
    cus_city: "Dhaka",
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: "01700000000",
  });

  let body: SessionResponse;
  try {
    const response = await fetch(SESSION_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = (await response.json()) as SessionResponse;
  } catch {
    throw new AppError(502, "The payment gateway is not responding. Please try again.");
  }

  if (body.status !== "SUCCESS" || !body.GatewayPageURL) {
    const reason = body.failedreason ? `: ${body.failedreason}` : "";
    throw new AppError(502, `The payment gateway refused the request${reason}`);
  }
  return { gatewayUrl: body.GatewayPageURL, sessionKey: body.sessionkey ?? null };
}

/** What the SSLCommerz validation API returns (only the fields TaskNest uses). */
export type GatewayValidation = {
  status?: string;
  tran_id?: string;
  val_id?: string;
  amount?: string;
  currency?: string;
  currency_type?: string;
  currency_amount?: string;
  bank_tran_id?: string;
  card_type?: string;
  tran_date?: string;
  risk_level?: string;
};

/**
 * Server-to-server check of a payment by its `val_id`. This is the only thing TaskNest trusts:
 * the success/IPN callbacks themselves can be faked by anyone (BR-19).
 */
export async function validateWithGateway(valId: string): Promise<GatewayValidation> {
  const { storeId, storePassword } = getCredentials();
  const url = new URL(VALIDATION_URL);
  url.search = new URLSearchParams({
    val_id: valId,
    store_id: storeId,
    store_passwd: storePassword,
    format: "json",
    v: "1",
  }).toString();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return (await response.json()) as GatewayValidation;
  } catch {
    throw new AppError(502, "Could not verify the payment with the gateway. Please try again.");
  }
}
