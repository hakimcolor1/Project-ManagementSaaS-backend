import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 hex digest. Used to store refresh tokens without keeping the token itself. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Compares two strings in constant time (no timing leak). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
