import { z } from "zod";

const email = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .max(255, "Email must be at most 255 characters")
  .pipe(z.email({ error: "Enter a valid email address" }));

const newPassword = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(64, "Password must be at most 64 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/\d/, "Password must contain at least one number");

/** ADMIN can never be chosen at signup. */
const signupRole = z.enum(["MANAGER", "MEMBER"], { error: "Role must be MANAGER or MEMBER" });

export const registerSchema = z.object({
  body: z.strictObject({
    name: z
      .string({ error: "Name is required" })
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be at most 100 characters"),
    email,
    password: newPassword,
    role: signupRole.default("MEMBER"),
  }),
});

export const loginSchema = z.object({
  body: z.strictObject({
    email,
    password: z.string({ error: "Password is required" }).min(1, "Password is required"),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.strictObject({
    refreshToken: z
      .string({ error: "refreshToken is required" })
      .min(1, "refreshToken is required"),
  }),
});

export const googleStartSchema = z.object({
  query: z.object({ role: signupRole.default("MEMBER") }),
});

export const googleCallbackSchema = z.object({
  query: z.object({
    code: z.string().max(2048).optional(),
    state: z.string().max(256).optional(),
    error: z.string().max(256).optional(),
  }),
});

export type SignupRole = z.infer<typeof signupRole>;
export type RegisterBody = z.infer<typeof registerSchema>["body"];
export type LoginBody = z.infer<typeof loginSchema>["body"];
export type RefreshTokenBody = z.infer<typeof refreshTokenSchema>["body"];
export type GoogleStartQuery = z.infer<typeof googleStartSchema>["query"];
export type GoogleCallbackQuery = z.infer<typeof googleCallbackSchema>["query"];
