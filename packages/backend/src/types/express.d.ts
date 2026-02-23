import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      user?: {
        id: string;
        role: Role;
      };
    }
  }
}

export {};
