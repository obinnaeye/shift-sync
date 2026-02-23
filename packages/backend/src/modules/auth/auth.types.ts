import type { Role } from "@prisma/client";

export type AccessTokenPayload = {
  sub: string;
  role: Role;
  typ: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  role: Role;
  sid: string;
  fid: string;
  typ: "refresh";
};
