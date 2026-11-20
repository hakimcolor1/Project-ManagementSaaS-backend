import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

export const GOOGLE_CALLBACK_PATH = "/api/v1/auth/google/callback";

export type GoogleProfile = {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

/** OAuth 2.0 client for the server-side "authorization code" flow. */
export function getGoogleClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(503, "Google login is not configured on this server");
  }
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.APP_URL}${GOOGLE_CALLBACK_PATH}`,
  });
}

/** Exchanges the code from Google's redirect and verifies the returned ID token. */
export async function getGoogleProfile(code: string): Promise<GoogleProfile> {
  const client = getGoogleClient();

  let payload: TokenPayload | undefined;
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new Error("No ID token");
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, "Google login failed. Please start again.");
  }

  if (!payload?.sub || !payload.email) {
    throw new AppError(401, "Google did not return an email address");
  }
  if (!payload.email_verified) {
    throw new AppError(401, "Your Google email address is not verified");
  }

  const email = payload.email.toLowerCase();
  const avatarUrl = payload.picture && payload.picture.length <= 500 ? payload.picture : null;
  return {
    googleId: payload.sub,
    email,
    name: (payload.name ?? email.split("@")[0] ?? "Google user").slice(0, 100),
    avatarUrl,
  };
}
