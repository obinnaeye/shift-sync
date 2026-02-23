export type Role = "ADMIN" | "MANAGER" | "STAFF";

export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive?: boolean;
  phone?: string | null;
  desiredWeeklyHours?: number | null;
};

export type Location = {
  id: string;
  name: string;
  timezone: string;
};

export type Skill = {
  id: string;
  name: string;
};

export type UserDetail = User & {
  createdAt: string;
  skills: Array<{ skill: Skill }>;
  certifications: Array<{ locationId: string; location: { id: string; name: string } }>;
  managedLocations?: Array<{ locationId: string; location: { id: string; name: string } }>;
};

export type Availability = {
  id: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isRecurring: boolean;
};

export type NotificationPreference = {
  userId: string;
  inApp: boolean;
  email: boolean;
};

export type Shift = {
  id: string;
  locationId: string;
  skillId: string;
  startTime: string;
  endTime: string;
  headcount: number;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  scheduleWeek: string;
  isPremium: boolean;
  location?: {
    id: string;
    name: string;
    timezone: string;
  };
  skill?: {
    id: string;
    name: string;
  };
  assignments?: Assignment[];
};

export type Assignment = {
  id: string;
  shiftId: string;
  userId: string;
  status: "CONFIRMED" | "DROPPED" | "SWAPPED";
  assignedAt: string;
  user?: User;
};

export type OnDutyEntry = {
  id: string;
  userId: string;
  shiftId: string;
  shiftStartTime: string;
  shiftEndTime: string;
  user: Pick<User, "id" | "firstName" | "lastName" | "email">;
};

export type ConstraintViolation = {
  rule: string;
  message: string;
  severity: "BLOCKING" | "WARNING";
};

export type ConstraintSuggestion = {
  userId: string;
  name: string;
  reason: string;
};

export type ConstraintErrorPayload = {
  error: "CONSTRAINT_VIOLATION";
  violations: ConstraintViolation[];
  suggestions: ConstraintSuggestion[];
};

export type WhatIfResult = {
  currentWeeklyHours: number;
  projectedWeeklyHours: number;
  currentDailyHours: number;
  projectedDailyHours: number;
  overtimeRisk: "LOW" | "WARNING" | "AT_LIMIT" | "OVER_LIMIT";
  consecutiveDays: number | null;
  warnings: string[];
};

export type SwapType = "SWAP" | "DROP";
export type SwapStatus =
  | "PENDING_ACCEPTANCE"
  | "OPEN"
  | "PENDING_MANAGER"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export type SwapRequest = {
  id: string;
  type: SwapType;
  status: SwapStatus;
  requesterId: string;
  targetId: string | null;
  assignmentId: string;
  expiresAt: string | null;
  managerNote: string | null;
  pickupAttempts: number;
  requester?: User;
  target?: User | null;
  assignment?: Assignment & { shift?: Shift };
};

export type AuditLog = {
  id: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  shiftId: string | null;
  createdAt: string;
  actor: Pick<User, "id" | "firstName" | "lastName" | "role">;
  shift: {
    id: string;
    startTime: string;
    endTime: string;
    location: { name: string };
  } | null;
};

export type FairnessEntry = {
  userId: string;
  firstName: string;
  lastName: string;
  totalHours: number;
  totalShifts: number;
  premiumShifts: number;
  desiredWeeklyHours: number | null;
};

export type FairnessReport = {
  report: FairnessEntry[];
  premiumFairnessScore: number;
  totalPremiumShifts: number;
  avgHours: number;
};

export type OvertimeEntry = {
  userId: string;
  firstName: string;
  lastName: string;
  weeklyHours: number;
  desiredWeeklyHours: number | null;
  overtimeRisk: "LOW" | "WARNING" | "AT_LIMIT" | "OVER_LIMIT";
  shifts: Array<{ shiftId: string; startTime: string; endTime: string; hours: number }>;
};
