import { z } from "zod";

export const roleSchema = z.enum(["ADMIN", "MANAGER", "STAFF"]);

export const loginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  csrfToken: z.string(),
});

export type Role = z.infer<typeof roleSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
