import { vi } from "vitest";

type Json = Record<string, unknown>;

/**
 * Replaces SSLCommerz with a fake (global fetch is mocked):
 * - the session API answers `session` (default: SUCCESS with a payment page URL),
 * - the validation API answers `validations.get(val_id)`, or INVALID_TRANSACTION.
 * Any other outgoing HTTP call fails the test.
 */
export function mockGateway(
  options: { session?: Json | "network-error"; validations?: Map<string, Json> } = {},
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));

    if (url.pathname.endsWith("/gwprocess/v4/api.php")) {
      if (options.session === "network-error") {
        throw new TypeError("fetch failed");
      }
      return Response.json(
        options.session ?? {
          status: "SUCCESS",
          GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/testcde123",
          sessionkey: "test-session-key",
        },
      );
    }

    if (url.pathname.endsWith("/validator/api/validationserverAPI.php")) {
      const valId = url.searchParams.get("val_id") ?? "";
      return Response.json(options.validations?.get(valId) ?? { status: "INVALID_TRANSACTION" });
    }

    throw new Error(`Unexpected HTTP call in a test: ${url.toString()}`);
  });
}

/** What the validation API returns for a real, matching 500.00 BDT payment. */
export function validPayment(tranId: string, overrides: Record<string, string> = {}): Json {
  return {
    status: "VALID",
    tran_id: tranId,
    val_id: "VAL-TEST",
    amount: "500.00",
    currency: "BDT",
    currency_type: "BDT",
    currency_amount: "500.00",
    bank_tran_id: "BANK-TEST-1",
    card_type: "VISA-Dutch Bangla",
    risk_level: "0",
    ...overrides,
  };
}
