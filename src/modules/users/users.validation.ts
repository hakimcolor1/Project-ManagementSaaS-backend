import { z } from "zod";

export const updateMeSchema = z.object({
  body: z
    .strictObject({
      name: z
        .string({ error: "Name must be text" })
        .trim()
        .min(2, "Name must be at least 2 characters")
        .max(100, "Name must be at most 100 characters")
        .optional(),
      avatarUrl: z
        .url({ protocol: /^https?$/, error: "avatarUrl must be a valid http(s) URL" })
        .max(500, "avatarUrl must be at most 500 characters")
        .nullable()
        .optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "Send at least one field to update: name or avatarUrl",
    }),
});

export type UpdateMeBody = z.infer<typeof updateMeSchema>["body"];
