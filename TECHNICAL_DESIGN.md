# ShiftSync — Technical Design Document

**Project:** Multi-Location Staff Scheduling Platform for "Coastal Eats"  
**Author:** Full-Stack Assessment Candidate  
**Date:** February 2026  
**Deadline:** 72 hours from receipt

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Database Schema](#4-database-schema)
5. [API Design](#5-api-design)
6. [Real-Time Design](#6-real-time-design)
7. [Core Business Logic](#7-core-business-logic)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [Background Jobs](#10-background-jobs)
11. [Timezone Handling](#11-timezone-handling)
12. [Audit Trail](#12-audit-trail)
13. [Seed Data Strategy](#13-seed-data-strategy)
14. [Non-Functional Requirements](#14-non-functional-requirements)
15. [Deployment Plan](#15-deployment-plan)
16. [Ambiguity Resolutions](#16-ambiguity-resolutions)

---

## 1. System Overview

ShiftSync is a web-based shift scheduling platform that allows a restaurant group with 4 locations across 2 time zones to manage staff scheduling. Three user roles — Admin, Manager, Staff — interact with the system to create/manage shifts, handle swap requests, track overtime, and view fairness analytics.

### Key Constraints to Enforce
- No double-booking (across locations)
- Minimum 10-hour rest gap between shifts
- Skill/certification matching
- Availability window compliance
- Overtime caps (daily 8h warn / 12h hard block, weekly 35h warn / 40h hard block)
- Consecutive day limits (6th day warn, 7th day requires override)
- Max 3 pending swap/drop requests per staff member
- Drop requests expire 24h before shift if unclaimed
- Swap requests auto-cancel if manager edits the underlying shift

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | React 18 + TypeScript | Component model, strong typing, ecosystem |
| **Styling** | Tailwind CSS + shadcn/ui | Rapid UI development, accessible components |
| **State Management** | Zustand + React Query | Zustand for global/auth state; React Query for server state/caching |
| **Calendar UI** | FullCalendar (React) | Handles complex calendar views out of the box |
| **Backend** | Node.js + Express + TypeScript | Non-blocking I/O suits real-time; same language as frontend |
| **Database** | PostgreSQL | ACID compliance for concurrent assignments; complex queries for analytics |
| **ORM** | Prisma | Type-safe queries, migrations, excellent DX |
| **Real-time** | Socket.io | WebSocket with polling fallback; rooms per location/user |
| **Cache / PubSub** | Redis | WebSocket state sync across instances; job queues |
| **Job Queue** | BullMQ (Redis-backed) | Drop request expiry, notification dispatch |
| **Auth** | JWT (access + refresh tokens) | Stateless; refresh stored in httpOnly cookie |
| **Email (simulated)** | Nodemailer → console/log | Simulation via stdout; swap for real SMTP in prod |
| **Validation** | Zod | Shared schemas between frontend and backend |
| **Testing** | Vitest + Supertest | Unit + integration |
| **Deployment** | Railway (backend + DB + Redis) + Vercel (frontend) | Fast free-tier deploy; Railway supports PG + Redis add-ons |
| **Monorepo** | pnpm workspaces | Shared types/schemas between packages |

### Repository Structure

```
shiftsync/
├── packages/
│   ├── shared/          # Zod schemas, TypeScript types, constants
│   ├── backend/         # Express API + Socket.io server
│   └── frontend/        # React app
├── pnpm-workspace.yaml
├── package.json
└── TECHNICAL_DESIGN.md
```

---

## 3. Architecture

### High-Level Diagram

```
┌─────────────────────────────────────────────────────┐
│                     Browser                          │
│  React App (Vercel)                                  │
│  - REST calls via React Query (axios)                │
│  - WebSocket connection via Socket.io client         │
└────────────┬──────────────────┬──────────────────────┘
             │ HTTPS REST       │ WSS
             ▼                  ▼
┌────────────────────────────────────────────────────┐
│              Node.js / Express + Socket.io          │
│              (Railway)                              │
│                                                    │
│  ┌─────────────┐   ┌──────────────┐               │
│  │  REST API   │   │ Socket.io    │               │
│  │  /api/v1/*  │   │  Server      │               │
│  └──────┬──────┘   └──────┬───────┘               │
│         │                 │                        │
│  ┌──────▼─────────────────▼───────┐               │
│  │        Business Logic Layer     │               │
│  │  (constraint engine, fairness, │               │
│  │   scheduling, overtime calc)   │               │
│  └──────┬──────────────────────────┘               │
│         │                                          │
│  ┌──────▼──────┐   ┌─────────────┐               │
│  │   Prisma    │   │   BullMQ    │               │
│  │   ORM       │   │   Workers   │               │
│  └──────┬──────┘   └──────┬──────┘               │
└─────────┼─────────────────┼──────────────────────┘
          ▼                 ▼
   ┌──────────────┐  ┌────────────┐
   │  PostgreSQL  │  │   Redis    │
   │  (Railway)   │  │  (Railway) │
   └──────────────┘  └────────────┘
```

### Request Flow: Shift Assignment

```
Manager clicks "Assign Staff" 
  → POST /api/v1/shifts/:id/assignments
  → Auth middleware (JWT verify + role check)
  → Constraint Engine:
      1. Check staff certified at location
      2. Check staff has required skill
      3. Check staff availability window
      4. Check no overlapping shift (incl. other locations)
      5. Check 10h rest gap
      6. Check daily/weekly hour totals
      7. Check consecutive day count
  → If any fail: return 422 with structured error + suggestions
  → If all pass: 
      - Begin DB transaction
        - SELECT shifts WHERE id = ? FOR UPDATE  (lock shift row for headcount check)
        - COUNT confirmed assignments; reject if >= headcount (409)
        - INSERT ShiftAssignment  (Postgres exclusion constraint fires here as final safety net)
        - INSERT AuditLog entry
      - Commit (exclusion constraint violation → 409 bubbled to caller)
      - Emit Socket.io event to affected staff room
      - Dispatch notification job to BullMQ
  → Return 201 with assignment + overtime warnings (if any)
```

---

## 4. Database Schema

### Prisma Schema (Conceptual)

#### Users & Roles

```prisma
model User {
  id                String              @id @default(uuid())
  email             String              @unique
  passwordHash      String
  firstName         String
  lastName          String
  role              Role                @default(STAFF)
  phone             String?
  desiredWeeklyHours Int?               // Staff stated desired hours
  isActive          Boolean             @default(true)
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  // Relations
  managedLocations  LocationManager[]
  certifications    LocationCertification[]
  skills            UserSkill[]
  availabilities    Availability[]
  assignments       ShiftAssignment[]
  sentSwapRequests  SwapRequest[]       @relation("Requester")
  receivedSwapReqs  SwapRequest[]       @relation("Target")
  notifications     Notification[]
  notifPreferences  NotificationPreference?
  auditLogs         AuditLog[]
}

enum Role {
  ADMIN
  MANAGER
  STAFF
}
```

#### Locations

```prisma
model Location {
  id          String    @id @default(uuid())
  name        String
  address     String
  timezone    String    // e.g. "America/Los_Angeles", "America/New_York"
  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())

  managers    LocationManager[]
  certifications LocationCertification[]
  shifts      Shift[]
}

model LocationManager {
  userId      String
  locationId  String
  user        User      @relation(fields: [userId], references: [id])
  location    Location  @relation(fields: [locationId], references: [id])

  @@id([userId, locationId])
}

model LocationCertification {
  userId      String
  locationId  String
  certifiedAt DateTime  @default(now())
  revokedAt   DateTime? // null = still active
  user        User      @relation(fields: [userId], references: [id])
  location    Location  @relation(fields: [locationId], references: [id])

  @@id([userId, locationId])
}
```

#### Skills

```prisma
model Skill {
  id    String      @id @default(uuid())
  name  String      @unique  // "bartender", "line cook", "server", "host"
  users UserSkill[]
  shifts Shift[]
}

model UserSkill {
  userId  String
  skillId String
  user    User    @relation(fields: [userId], references: [id])
  skill   Skill   @relation(fields: [skillId], references: [id])

  @@id([userId, skillId])
}
```

#### Availability

```prisma
// Recurring weekly availability (e.g., "Monday 9am-5pm")
model Availability {
  id          String    @id @default(uuid())
  userId      String
  dayOfWeek   Int       // 0 (Sun) - 6 (Sat); null = one-off
  startTime   String    // "09:00" — stored in user's local time
  endTime     String    // "17:00"
  timezone    String    // The timezone this availability was set in
  isRecurring Boolean   @default(true)
  user        User      @relation(fields: [userId], references: [id])
}

// One-off exceptions (overrides recurring availability)
model AvailabilityException {
  id          String    @id @default(uuid())
  userId      String
  date        DateTime  @db.Date
  startTime   String?   // null = unavailable all day
  endTime     String?
  isAvailable Boolean   // false = blocked out day; true = custom window
  user        User      @relation(fields: [userId], references: [id])
}
```

#### Shifts & Assignments

```prisma
model Shift {
  id              String    @id @default(uuid())
  locationId      String
  skillId         String
  startTime       DateTime  // Stored in UTC
  endTime         DateTime  // Stored in UTC (may be next calendar day for overnight)
  headcount       Int       // Number of staff needed
  isPremium       Boolean   @default(false) // Fri/Sat evening flag
  status          ShiftStatus @default(DRAFT)
  scheduleWeek    DateTime  @db.Date  // ISO week start (Monday)
  publishedAt     DateTime?
  editCutoffAt    DateTime? // Default: startTime - 48h
  createdBy       String    // Manager userId
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  location        Location  @relation(fields: [locationId], references: [id])
  skill           Skill     @relation(fields: [skillId], references: [id])
  assignments     ShiftAssignment[]
  auditLogs       AuditLog[]
}

enum ShiftStatus {
  DRAFT        // Created, not published
  PUBLISHED    // Visible to staff
  CANCELLED
}

model ShiftAssignment {
  id             String    @id @default(uuid())
  shiftId        String
  userId         String
  assignedBy     String    // Manager userId
  assignedAt     DateTime  @default(now())
  status         AssignmentStatus @default(CONFIRMED)
  // Denormalized from Shift to enable the GiST exclusion constraint for overlap detection.
  // Must be kept in sync with Shift.startTime / Shift.endTime on any shift edit.
  shiftStartTime DateTime
  shiftEndTime   DateTime

  shift          Shift     @relation(fields: [shiftId], references: [id])
  user           User      @relation(fields: [userId], references: [id])
  swapRequest    SwapRequest?

  @@unique([shiftId, userId])
}

enum AssignmentStatus {
  CONFIRMED
  DROPPED   // Drop request approved
  SWAPPED   // Swap completed
}
```

#### Swap & Drop Requests

```prisma
model SwapRequest {
  id              String        @id @default(uuid())
  type            SwapType      // SWAP | DROP
  requesterId     String        // Staff A (shift owner)
  targetId        String?       // Staff B (null for DROP until someone picks it up)
  assignmentId    String        @unique
  status          SwapStatus
  managerApprovedBy String?     // Manager userId who approved/rejected
  managerNote     String?
  expiresAt       DateTime?     // DROP only: shift.startTime - 24h
  pickupAttempts  Int           @default(0)  // DROP only: incremented on each manager rejection; capped at 3
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  requester       User          @relation("Requester", fields: [requesterId], references: [id])
  target          User?         @relation("Target", fields: [targetId], references: [id])
  assignment      ShiftAssignment @relation(fields: [assignmentId], references: [id])
}

enum SwapType {
  SWAP
  DROP
}

enum SwapStatus {
  // SWAP states
  PENDING_ACCEPTANCE    // Staff A sent request; waiting for Staff B to accept or reject
  // DROP states
  OPEN                  // Drop posted; available for any qualified staff to pick up
  // Shared states (reached from different paths depending on type)
  PENDING_MANAGER       // SWAP: Staff B accepted → awaiting manager; DROP: someone picked up → awaiting manager
  APPROVED              // Manager approved the swap or drop
  REJECTED              // Manager rejected
  CANCELLED             // Requester cancelled, or auto-cancelled (shift edited, etc.)
  EXPIRED               // DROP only: no one claimed it before expiresAt
}
```

#### Finite State Machines

**SWAP FSM:**
```
                     ┌─────────────┐
              create │             │
  ──────────────────►│  PENDING_   │ Staff B accepts
                     │  ACCEPTANCE ├──────────────────► PENDING_MANAGER ──► APPROVED
                     │             │                           │
                     └──────┬──────┘                          ├──────────► REJECTED
                            │                                 │
                            │ Staff B rejects                 │ Manager n/a
                            ▼                                 ▼
                         CANCELLED ◄─────────────────── CANCELLED
                            ▲
                            │ Requester cancels (any time before APPROVED)
                            │ OR shift edited by manager
```

**DROP FSM:**
```
                ┌──────┐
         create │      │ Staff X picks up (targetId set)
  ─────────────►│ OPEN ├───────────────────────────► PENDING_MANAGER ──► APPROVED
                │      │                                    │
                └──┬───┘                                    ├──────────► REJECTED
                   │                                        │             (target notified,
                   │ expiresAt reached                      │              drops back to OPEN
                   ▼ (no one claimed)                       │              if pickupAttempts < 3)
                EXPIRED                                CANCELLED
                   │
                   │ Requester cancels (while OPEN)
                   ▼
                CANCELLED
```

> **Pickup attempt counter**: The `SwapRequest` model carries a `pickupAttempts Int @default(0)` field. Each time a manager rejection sends the drop back to `OPEN`, `pickupAttempts` is incremented in the same transaction. When `pickupAttempts >= 3` on a rejection, the drop transitions to `CANCELLED` instead of `OPEN`, and the original requester is notified that no coverage was found. The 3-attempt ceiling prevents a drop from bouncing indefinitely in the manager queue.

**Idempotency rules:**
- Duplicate `POST /swap-requests` for the same `assignmentId` while one is `OPEN` or `PENDING_ACCEPTANCE` returns the existing request (409 with existing resource), not a new one.
- Duplicate `accept` / `pickup` actions on an already `PENDING_MANAGER` request return 409.
- `cancel` on an already terminal state (`APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`) is a no-op with 200.

#### Notifications

```prisma
model Notification {
  id          String    @id @default(uuid())
  userId      String
  type        NotificationType
  title       String
  body        String
  metadata    Json      // { shiftId, swapRequestId, etc. }
  isRead      Boolean   @default(false)
  createdAt   DateTime  @default(now())

  user        User      @relation(fields: [userId], references: [id])
}

enum NotificationType {
  SHIFT_ASSIGNED
  SHIFT_CHANGED
  SHIFT_CANCELLED
  SCHEDULE_PUBLISHED
  SWAP_REQUEST_RECEIVED
  SWAP_REQUEST_ACCEPTED
  SWAP_REQUEST_REJECTED
  SWAP_REQUEST_CANCELLED
  SWAP_APPROVED
  DROP_REQUEST_RECEIVED
  DROP_AVAILABLE
  OVERTIME_WARNING
  AVAILABILITY_CHANGED
}

model NotificationPreference {
  userId    String    @id
  inApp     Boolean   @default(true)
  email     Boolean   @default(false)
  user      User      @relation(fields: [userId], references: [id])
}
```

#### Audit Trail

```prisma
model AuditLog {
  id          String    @id @default(uuid())
  actorId     String    // Who made the change
  entityType  String    // "Shift", "ShiftAssignment", "SwapRequest", etc.
  entityId    String
  action      String    // "CREATE", "UPDATE", "DELETE", "PUBLISH", "APPROVE", etc.
  before      Json?     // Snapshot before change
  after       Json?     // Snapshot after change
  reason      String?   // For override actions
  createdAt   DateTime  @default(now())

  actor       User      @relation(fields: [actorId], references: [id])
}
```

#### Manager Override Log

```prisma
model ManagerOverride {
  id          String    @id @default(uuid())
  managerId   String
  userId      String    // Staff affected
  overrideType String   // "7TH_CONSECUTIVE_DAY", "12H_DAILY_LIMIT"
  shiftId     String
  reason      String    // Required reason text
  createdAt   DateTime  @default(now())
}
```

### Key Indexes

```sql
-- Requires btree_gist extension for mixed-type GiST indexes
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Overlap detection: GiST index on a tstzrange derived from denormalized shift times.
-- shift_period is a generated stored column: tstzrange(shift_start_time, shift_end_time).
-- The exclusion constraint uses this index to enforce no two CONFIRMED assignments
-- for the same user can overlap in time, enforced at the DB level.
ALTER TABLE shift_assignments
  ADD COLUMN shift_period tstzrange
    GENERATED ALWAYS AS (tstzrange(shift_start_time, shift_end_time)) STORED;

CREATE INDEX idx_assignments_user_period ON shift_assignments
  USING GIST (user_id, shift_period)
  WHERE status = 'CONFIRMED';

ALTER TABLE shift_assignments
  ADD CONSTRAINT no_overlap_per_user
  EXCLUDE USING GIST (user_id WITH =, shift_period WITH &&)
  WHERE (status = 'CONFIRMED');

-- Headcount enforcement: fast count of confirmed assignments per shift
CREATE INDEX idx_assignments_shift_status ON shift_assignments (shift_id, status)
  WHERE status = 'CONFIRMED';

-- Swap request count per user (enforce max-3 pending limit)
CREATE INDEX idx_swap_pending_user ON swap_requests (requester_id, status)
  WHERE status IN ('PENDING_ACCEPTANCE', 'OPEN', 'PENDING_MANAGER');

-- Notifications feed (unread-first, per user)
CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC);

-- Audit trail lookup per entity
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id, created_at DESC);
```

> **Denormalization sync rule**: whenever `Shift.startTime` or `Shift.endTime` is updated, the corresponding `ShiftAssignment.shiftStartTime` / `shiftEndTime` rows must be updated in the same transaction. The application enforces this in the `ShiftService.update()` method; the exclusion constraint then re-validates all affected assignments automatically.

---

## 5. API Design

Base URL: `/api/v1`

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Email + password → access token + httpOnly refresh cookie |
| POST | `/auth/refresh` | Refresh access token using cookie |
| POST | `/auth/logout` | Invalidate refresh token |
| GET  | `/auth/me` | Current user profile |

### Users

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/users` | Admin | List all users |
| POST | `/users` | Admin | Create user |
| GET | `/users/:id` | Admin/Self | Get user |
| PATCH | `/users/:id` | Admin/Self | Update user |
| GET | `/users/:id/skills` | Any | Get user's skills |
| PUT | `/users/:id/skills` | Admin | Update skills |
| GET | `/users/:id/certifications` | Any | Get location certifications |
| PUT | `/users/:id/certifications` | Admin | Update certifications |
| GET | `/users/:id/availability` | Manager+/Self | Get availability |
| PUT | `/users/:id/availability` | Self | Update recurring availability |
| POST | `/users/:id/availability/exceptions` | Self | Add one-off exception |

### Locations

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/locations` | Any | List accessible locations |
| POST | `/locations` | Admin | Create location |
| GET | `/locations/:id` | Any | Get location details |
| GET | `/locations/:id/staff` | Manager+ | Staff certified at location |
| GET | `/locations/:id/on-duty` | Manager+ | Currently clocked-in staff (real-time) |

### Shifts

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/shifts` | Any | List shifts (filtered by location, week, status) |
| POST | `/shifts` | Manager+ | Create shift |
| GET | `/shifts/:id` | Any | Get shift detail |
| PATCH | `/shifts/:id` | Manager+ | Edit shift (checks cutoff) |
| DELETE | `/shifts/:id` | Manager+ | Cancel shift |
| GET | `/shifts/:id/history` | Manager+ | Audit trail for shift |
| GET | `/shifts/:id/eligible-staff` | Manager+ | Staff who can fill this shift |

### Schedules (Week-Level Operations)

Publishing is a week-level action, not a per-shift action — it atomically transitions all `DRAFT` shifts for a given location and week to `PUBLISHED`, making them visible to staff in one operation. Using a per-shift endpoint would require N calls and create partial-visibility race conditions.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/schedules/:locationId/:week/publish` | Manager+ | Publish all DRAFT shifts for this location+week |
| POST | `/schedules/:locationId/:week/unpublish` | Manager+ | Unpublish (sets back to DRAFT, only before cutoff) |
| GET | `/schedules/:locationId/:week` | Any | Get full week schedule for a location |

> `week` is an ISO date string for the Monday of that week (e.g. `2026-02-23`). The publish endpoint rejects if any shift in the week has already passed its `editCutoffAt`.

### Assignments

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/shifts/:id/assignments` | Manager+ | Assign staff to shift |
| DELETE | `/shifts/:id/assignments/:userId` | Manager+ | Remove assignment |
| GET | `/shifts/:id/assignments` | Manager+ | List assignments for shift |

**Constraint Violation Response (422):**
```json
{
  "error": "CONSTRAINT_VIOLATION",
  "violations": [
    {
      "rule": "AVAILABILITY_WINDOW",
      "message": "Sarah Chen is not available on Monday 6-10pm (she set availability as 9am-3pm)",
      "severity": "BLOCKING"
    },
    {
      "rule": "WEEKLY_OVERTIME_WARNING",
      "message": "This assignment would put Sarah at 38h for the week (warn threshold: 35h)",
      "severity": "WARNING"
    }
  ],
  "suggestions": [
    {
      "userId": "...",
      "name": "John Park",
      "reason": "Has bartender skill, certified at this location, available 6-10pm, currently at 28h/week"
    },
    {
      "userId": "...",
      "name": "Maria Santos",
      "reason": "Has bartender skill, certified at this location, available 6-10pm, currently at 22h/week"
    }
  ]
}
```

### Swap & Drop Requests

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/swap-requests` | Staff | Create swap or drop request |
| GET | `/swap-requests` | Any | List requests (filtered by role) |
| GET | `/swap-requests/:id` | Any | Get request detail |
| POST | `/swap-requests/:id/accept` | Staff (target) | Accept incoming swap |
| POST | `/swap-requests/:id/reject` | Staff (target) | Reject incoming swap |
| POST | `/swap-requests/:id/cancel` | Staff (requester) | Cancel request |
| POST | `/swap-requests/:id/approve` | Manager+ | Manager approves |
| POST | `/swap-requests/:id/reject-manager` | Manager+ | Manager rejects |
| GET | `/shifts/:id/drop-available` | Staff | List unclaimed drop requests for shift |
| POST | `/swap-requests/:id/pickup` | Staff | Pick up a dropped shift |

### Analytics & Reports

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/analytics/hours` | Manager+ | Hours per staff for date range |
| GET | `/analytics/fairness` | Manager+ | Premium shift distribution report |
| GET | `/analytics/overtime` | Manager+ | Projected overtime for week |
| GET | `/analytics/what-if` | Manager+ | What-if: hours impact of a proposed assignment |
| GET | `/audit-logs` | Admin | Export audit logs with filters |

### Notifications

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/notifications` | Any | Get notification feed |
| POST | `/notifications/read-all` | Any | Mark all as read |
| PATCH | `/notifications/:id/read` | Any | Mark single as read |
| GET | `/notifications/preferences` | Any | Get preferences |
| PUT | `/notifications/preferences` | Any | Update preferences |

---

## 6. Real-Time Design

### Socket.io Room Strategy

```
Rooms:
  user:{userId}          — Personal notifications for any user
  location:{locationId}  — Schedule updates for a location
  admin                  — Broadcast admin events
```

### Events: Server → Client

| Event | Room | Payload | Trigger |
|---|---|---|---|
| `schedule:published` | `location:{id}` | `{ locationId, week, shiftIds }` | Manager publishes |
| `schedule:updated` | `location:{id}` | `{ shiftId, changes }` | Shift edited |
| `assignment:created` | `user:{staffId}` | `{ shift, assignment }` | Staff assigned |
| `assignment:removed` | `user:{staffId}` | `{ shiftId }` | Assignment removed |
| `swap:received` | `user:{targetId}` | `{ swapRequest, shift }` | Swap request created |
| `swap:accepted` | `user:{requesterId}` | `{ swapRequest }` | Target accepts |
| `swap:resolved` | `user:{*}` | `{ swapRequest, outcome }` | Manager decides |
| `swap:cancelled` | `user:{*}` | `{ swapRequest, reason }` | Auto-cancel or manual |
| `drop:available` | `location:{id}` | `{ swapRequest, shift }` | Drop request created |
| `drop:claimed` | `location:{id}` | `{ shiftId }` | Drop picked up |
| `overtime:warning` | `user:{managerId}` | `{ staffId, week, projectedHours }` | Building schedule |
| `conflict:detected` | `user:{managerId}` | `{ staffId, conflictingManagerId }` | Concurrent assignment |
| `on-duty:update` | `location:{id}` | `{ userId, action: 'clock-in'\|'clock-out' }` | Clock events |
| `notification:new` | `user:{userId}` | `{ notification }` | Any notification created |

### Concurrent Assignment Conflict Detection

Application-level Redis locks are **not sufficient alone**: a lock with a finite TTL can expire during a slow constraint check, and a process crash between lock release and transaction commit leaves no DB-level guarantee. Two concurrent transactions can both pass the overlap check before either commits.

**Two-layer strategy:**

#### Layer 1 — Postgres DB-level exclusion constraint (hard invariant)

The `ShiftAssignment` table denormalizes shift times to enable a GiST exclusion constraint directly in the database (see [Key Indexes](#key-indexes)). This makes double-booking physically impossible regardless of application code:

```sql
-- Enforced by Postgres; no application-level bug can bypass this
ALTER TABLE shift_assignments
  ADD CONSTRAINT no_overlap_per_user
  EXCLUDE USING GIST (
    user_id   WITH =,
    shift_period WITH &&   -- tstzrange overlap operator
  )
  WHERE (status = 'CONFIRMED');
```

If two concurrent transactions both try to insert an overlapping assignment for the same user, one will succeed and the other will receive a Postgres `23P01` (exclusion_violation) error, which the application catches and returns as a 409 Conflict.

For **headcount enforcement**, the assignment transaction uses `SELECT ... FOR UPDATE` on the shift row to lock it before counting confirmed assignments:

```sql
BEGIN;
  SELECT headcount FROM shifts WHERE id = $shiftId FOR UPDATE;
  SELECT COUNT(*) FROM shift_assignments WHERE shift_id = $shiftId AND status = 'CONFIRMED';
  -- If count >= headcount: ROLLBACK and return 409
  INSERT INTO shift_assignments ...;
COMMIT;
```

#### Layer 2 — Redis advisory lock (UX conflict signal)

The Redis lock (`SET lock:assign:{staffId} NX EX 10`) is kept as a **best-effort UX layer** only — its sole purpose is to detect when two managers are concurrently working on the same staff member and emit a `conflict:detected` socket event to the second manager so they see a live warning before their request even reaches the DB. It does not provide correctness guarantees; correctness is fully owned by the Postgres constraint.

```
Manager A → acquires Redis lock → checks constraints → DB transaction (exclusion constraint enforced)
Manager B → lock NOT acquired → emits conflict:detected to Manager B's socket room → Manager B still proceeds
           → if Manager A's TX commits first, Manager B's TX gets exclusion violation → 409 returned
```

---

## 7. Core Business Logic

### Constraint Engine

All constraints are run in the `ConstraintEngine` service class before any assignment is persisted. Each check returns `{ passed: boolean, severity: 'BLOCKING' | 'WARNING', rule: string, message: string }`.

```
Blocking (assignment rejected unless an explicit override path is invoked — see notes):
  1. CERTIFICATION         — Staff certified at location?
  2. SKILL_MATCH           — Staff has required skill?
  3. AVAILABILITY          — Shift within staff's availability window?
  4. NO_OVERLAP            — No overlapping active shift?
  5. REST_GAP              — ≥ 10h after previous shift end?
  6. DAILY_HARD_LIMIT      — Would exceed 12h in calendar day?       [override path exists]
  7. WEEKLY_HARD_LIMIT     — Would exceed 40h for the ISO week?      [no override; absolute cap]

Warnings (assignment proceeds after explicit manager acknowledgment):
  8.  WEEKLY_WARNING       — Would reach 35–39h for the week? (warn before hitting the 40h cap)
  9.  DAILY_WARNING        — Would exceed 8h in calendar day?
  10. CONSECUTIVE_6TH_DAY  — 6th consecutive day?
  11. CONSECUTIVE_7TH_DAY  — 7th consecutive day?                    [override path exists]
```

> **Override path semantics**: Rules marked `[override path exists]` are still hard blocks by default — the assignment is rejected outright on first attempt. The override path is a *separate, explicit follow-up action*: the manager re-submits with a documented reason and a `?forceOverride=true` flag (or via a dedicated confirm endpoint). This is not a "warn and proceed" — it is a second deliberate decision. Rules marked `[no override]` (`WEEKLY_HARD_LIMIT`) have no such path; the API returns 422 unconditionally.

#### Overlap & Rest Gap Calculation

- "Overlap" = any two shifts where `shift1.endTime > shift2.startTime AND shift1.startTime < shift2.endTime`
- "Rest gap" = `shift2.startTime - shift1.endTime < 10 hours` (UTC comparison)
- Both checks query ALL assignments for the user across ALL locations

#### Availability Resolution (multi-timezone)

The canonical algorithm (also documented in [Section 11](#11-timezone-handling)) works entirely in UTC instants, avoiding ambiguity around DST gaps and folds:

```
Given: shift.startTime (UTC), shift.endTime (UTC), staff availability record

1. Determine the calendar date of the shift in the staff's availability timezone:
      shiftDate = toZonedTime(shift.startTime, availability.timezone)  // e.g. "2026-02-23"
      dayOfWeek = shiftDate.getDay()

2. Look up the staff's availability rule for that dayOfWeek (recurring)
   or an AvailabilityException for that specific date (takes precedence).

3. Construct absolute UTC instants for the availability window on that date:
      availStart = fromZonedTime({ date: shiftDate, time: rule.startTime }, availability.timezone)
      availEnd   = fromZonedTime({ date: shiftDate, time: rule.endTime },   availability.timezone)
      // date-fns-tz handles DST: "9am" on a spring-forward day produces the correct UTC instant

4. Check containment in UTC:
      shift.startTime >= availStart  AND  shift.endTime <= availEnd

5. DST edge cases:
   - If availStart falls in a DST gap (clock jumps forward), date-fns-tz advances to the next valid instant.
   - If availEnd falls in a DST fold (clock falls back), the later interpretation is used.
   Both behaviors are consistent with "the staff intended the wall-clock window on that day."
```

#### Consecutive Day Calculation

A "worked day" = any calendar date (in the location's timezone) on which the staff member has at least one confirmed, non-cancelled shift. A 1-hour shift counts the same as an 11-hour shift for consecutive day calculation (see [Ambiguity Resolutions](#16-ambiguity-resolutions)).

### Premium Shift Detection

A shift is automatically tagged `isPremium = true` if:
- Day of week is Friday or Saturday (in the location's timezone)
- Shift start time is between 17:00 and 23:00 local time

### What-If Overtime Calculation

`GET /analytics/what-if?staffId=X&shiftId=Y` returns:
```json
{
  "currentWeeklyHours": 32,
  "projectedWeeklyHours": 40,
  "currentDailyHours": 6,
  "projectedDailyHours": 8,
  "overtimeRisk": "AT_LIMIT",
  "consecutiveDays": 5,
  "warnings": []
}
```

### Drop Request Expiry

BullMQ job `expire-drop-request` is scheduled at the time the drop request is created:
- `delay = shift.startTime - 24h - now()`
- On execution: if status is still `OPEN`, set to `EXPIRED`, notify requester

> **Consistency note**: DROP requests start at `OPEN` (not `PENDING_ACCEPTANCE` — that state belongs to the SWAP flow). The expiry job must check for `OPEN`, not `PENDING_ACCEPTANCE`, or drops will never expire correctly.

### Swap Auto-Cancellation

When a manager edits a shift (`PATCH /shifts/:id`), the backend queries for any `SwapRequest` linked to that shift's assignments with status in `{PENDING_ACCEPTANCE, OPEN, PENDING_MANAGER}`. It sets them to `CANCELLED` with reason `"Shift was edited by manager"` and emits `swap:cancelled` to all parties. APPROVED swaps follow the separate policy defined in [Ambiguity Resolution #4](#4-shift-edited-after-swap-approval-but-before-it-occurs).

---

## 8. Frontend Architecture

### Page Structure

```
/login
/dashboard                    — Overview (role-dependent)
/schedule                     — Main calendar view
  ?locationId=...
  ?week=2026-02-16
/shifts/:id                   — Shift detail + assignment panel
/staff                        — Staff directory (Manager+)
/staff/:id                    — Staff profile + availability
/swap-requests                — Swap/drop request queue
/analytics                    — Reports (Manager+)
  /analytics/hours
  /analytics/fairness
  /analytics/overtime
/notifications                — Notification center
/admin                        — Admin panel
  /admin/users
  /admin/locations
  /admin/audit-logs
/settings                     — User settings + notification preferences
```

### Key UI Components

- **ScheduleCalendar** — FullCalendar week view, color-coded by location/skill, draggable assignments
- **ConstraintFeedback** — Toast + inline panel showing violations + suggestions after a failed assignment
- **OvertimeDashboard** — Bar chart per staff member showing current vs projected hours for the week
- **WhatIfPanel** — Side panel that previews overtime impact before confirming an assignment
- **OnDutyBoard** — Real-time live board of who's working now at each location (auto-updates via Socket.io)
- **SwapRequestQueue** — Kanban-style view of swap/drop requests by status
- **FairnessReport** — Table + heatmap of premium shift distribution
- **NotificationCenter** — Dropdown bell with unread count, infinite scroll feed
- **AvailabilityEditor** — Weekly grid where staff set their recurring windows + exception calendar

### State Management

```
Zustand stores:
  authStore        — currentUser, accessToken, logout()
  socketStore      — socket instance, connection status
  notificationStore — unread count, recent notifications (hydrated from API, updated via socket)

React Query:
  All server data (shifts, users, analytics, etc.) via useQuery / useMutation
  Automatic cache invalidation triggered by socket events
  (e.g., schedule:updated → queryClient.invalidateQueries(['shifts', locationId, week]))
```

---

## 9. Authentication & Authorization

### JWT Strategy

- **Access token**: 15-minute expiry, stored in memory (Zustand store, never in `localStorage`)
- **Refresh token**: 7-day expiry, stored in `httpOnly; SameSite=None; Secure` cookie
- On 401, React Query's global error handler calls `/auth/refresh` before retrying the original request
- Refresh tokens stored in Redis with user ID mapping (allows server-side invalidation on logout from all devices)
- **Refresh token rotation**: every `/auth/refresh` call issues a new refresh token and invalidates the old one in Redis; reuse of a previously invalidated token invalidates the entire family (detects theft)

### Cross-Site Cookie Strategy

The frontend (Vercel, e.g. `https://shiftsync.vercel.app`) and backend (Railway, e.g. `https://shiftsync-api.railway.app`) are on different origins. `SameSite=Strict` silently drops the cookie on all cross-site requests, breaking the refresh flow in production.

**Required configuration:**

| Concern | Solution |
|---|---|
| Cookie sending | `SameSite=None; Secure` — explicitly allows cross-site cookies |
| CORS | Backend sets `Access-Control-Allow-Origin: https://shiftsync.vercel.app` (exact allowlist, no wildcard) + `Access-Control-Allow-Credentials: true` |
| CSRF on cookie mutations | `/auth/refresh` and `/auth/logout` require a `X-CSRF-Token` header; the value is a short-lived token embedded in the login response body and stored in memory; cookie-only requests (e.g. from a third-party site) lack the header and are rejected with 403 |
| Token leakage | Access token is never written to `localStorage` or `sessionStorage`; only held in Zustand memory (cleared on tab close) |

> **Note on local development**: In dev, both services run on `localhost` with different ports; `SameSite=Lax` + no `Secure` flag works fine. The cookie attributes are conditioned on `NODE_ENV=production`.

### Route Guards (Frontend)

```
<AdminRoute>    — Role === ADMIN
<ManagerRoute>  — Role === ADMIN or MANAGER
<PrivateRoute>  — Any authenticated user
```

### Middleware (Backend)

```
authenticate    — Verifies JWT, attaches req.user
requireRole(roles[])  — Checks role membership
requireLocationAccess — For manager: verifies they manage the location in request
```

---

## 10. Background Jobs (BullMQ)

| Queue | Job | Trigger | Action |
|---|---|---|---|
| `notifications` | `send-notification` | Any notification created | Check user prefs → in-app (socket emit) + email (log) |
| `swap-expiry` | `expire-drop-request` | Drop request created | Set to EXPIRED if unclaimed at 24h before shift |
| `schedule-reminders` | `upcoming-shift-reminder` | Shift published | Remind staff 24h and 2h before shift |
| `analytics` | `compute-weekly-fairness` | End of each week | Precompute fairness scores |

---

## 11. Timezone Handling

### Core Rules

1. **All `DateTime` values in the database are stored in UTC** (Prisma handles this via `@db.Timestamptz`)
2. **Each location has a `timezone` field** (IANA format, e.g., `"America/Los_Angeles"`)
3. **Staff availability** is stored with a `timezone` field (the timezone the staff was in when they set it)
4. **All UI rendering** converts UTC to the location's timezone using `date-fns-tz`

### Availability vs. Shift Timezone Reconciliation

The canonical algorithm works entirely in UTC instants. The location's timezone is used only for display and for determining the calendar date of the shift from the staff member's perspective (which governs which day-of-week availability rule applies). All comparisons are done as UTC instants after constructing the availability window for that specific date.

```
Given: shift.startTime (UTC), shift.endTime (UTC),
       staff availability record { dayOfWeek, startTime "HH:MM", endTime "HH:MM", timezone }

Step 1 — Resolve the calendar date in the staff's availability timezone:
  shiftDate = toZonedTime(shift.startTime, availability.timezone)
  dayOfWeek = shiftDate.getDay()

Step 2 — Load the applicable rule:
  Check AvailabilityException for shiftDate.date first (one-off overrides recurring).
  Else load Availability where dayOfWeek matches.
  If no rule exists → staff is unavailable → BLOCKING violation.

Step 3 — Construct UTC instants for the availability window on that calendar date:
  availStart = fromZonedTime({ date: shiftDate, time: rule.startTime }, availability.timezone)
  availEnd   = fromZonedTime({ date: shiftDate, time: rule.endTime },   availability.timezone)

Step 4 — Containment check (all UTC):
  PASS if: shift.startTime >= availStart AND shift.endTime <= availEnd

Step 5 — DST edge cases:
  DST gaps (clocks spring forward): date-fns-tz advances to the next valid instant automatically.
  DST folds (clocks fall back): the later of the two ambiguous instants is used.
  These behaviors match the intuition "the staff meant the wall-clock window on that day."
```

> **Why not convert to location timezone?** The location timezone is irrelevant for availability checking — availability is set by the staff member relative to their own life. The location timezone is only used for display and for the consecutive-day calculation.

### Overnight Shifts

A shift `startTime: 23:00, endTime: 03:00` is stored as:
- `startTime: 2026-02-20T23:00:00Z`
- `endTime: 2026-02-21T03:00:00Z`

The UI renders this as "11pm – 3am (next day)" when `endTime.date !== startTime.date` in local timezone.

### Staff at Multiple Timezones (Scenario: Timezone Tangle)

A staff member sets availability "9am-5pm" in their home timezone (e.g., Pacific). They are certified at:
- Location A (Pacific): 9am-5pm PST is directly applicable
- Location B (Eastern): The system converts their 9am-5pm PST window to Eastern → they appear available 12pm-8pm EST

Managers at Location B see staff availability already converted to Eastern time. Staff also see their shifts displayed in the location's local time, not their home timezone. The system stores availability with the timezone it was set in and converts at constraint-check time.

---

## 12. Audit Trail

Every mutation runs through an `AuditService.log()` call within the same database transaction:

```typescript
await auditService.log({
  actorId: req.user.id,
  entityType: 'ShiftAssignment',
  entityId: assignment.id,
  action: 'CREATE',
  before: null,
  after: assignment,
});
```

The audit log captures:
- Schedule publish/unpublish
- Shift create/edit/cancel
- Assignment create/remove
- Swap request state transitions
- Manager overrides (with reason)
- User certification changes
- Notification preference changes

Admin export endpoint streams results as newline-delimited JSON or CSV.

---

## 13. Seed Data Strategy

The seed script will create:

### Locations (4)
| Name | Timezone |
|---|---|
| Coastal Eats - Venice Beach | America/Los_Angeles |
| Coastal Eats - Santa Monica | America/Los_Angeles |
| Coastal Eats - Miami Beach | America/New_York |
| Coastal Eats - South Beach | America/New_York |

### Users
- 1 Admin
- 4 Managers (one per location, one also managing a second)
- 20 Staff with varied skills and certifications:
  - Some certified at 1 location, some at 2+ (including cross-timezone)
  - Staff with conflicting availabilities
  - Staff already near weekly hour limits

### Pre-seeded Scenarios
- A published schedule for the current week with several shifts already assigned
- A pending swap request between two staff members
- A drop request expiring in 25 hours
- An existing shift that would cause overtime if another is added (for the Overtime Trap test)
- A staff member certified at both Pacific and Eastern locations (for Timezone Tangle)
- One shift with 2 managers eligible to assign the same bartender (for Simultaneous Assignment)
- A staff member who has NOT received any Saturday night shifts in the last 4 weeks (for Fairness Complaint)

---

## 14. Non-Functional Requirements

### Service Level Objectives (SLOs)

| SLO | Target | Notes |
|---|---|---|
| API p99 latency (constraint check + write) | < 800ms | Includes DB transaction; GiST index keeps overlap scan fast |
| API p99 latency (read/list endpoints) | < 300ms | Backed by indexed queries |
| WebSocket event delivery (publish → staff sees) | < 2s | Socket.io with Redis adapter |
| Availability (uptime) | 99.5% monthly | Railway hobby tier; acceptable for assessment |
| Concurrent users | 50 simultaneous | 4 locations × ~10 active users; single Node.js instance |

### Observability

**Structured logging** — All log lines are JSON with the following fields:

```json
{
  "level": "info",
  "ts": "2026-02-23T14:00:00.000Z",
  "correlationId": "req-abc123",   // UUID injected by middleware on every request
  "userId": "...",
  "method": "POST",
  "path": "/api/v1/shifts/xxx/assignments",
  "statusCode": 201,
  "durationMs": 142
}
```

A `correlationId` middleware injects a UUID per request and attaches it to the Express `req` object. Every downstream log, DB query log, and BullMQ job picks up the same ID so errors can be traced across layers.

**Health check endpoints:**
- `GET /healthz` — returns `200 OK { status: "ok" }` (used by Railway's health probe)
- `GET /readyz` — checks DB connectivity and Redis ping; returns `503` if either is down

**Error alerting** — In this assessment scope, errors are surfaced via Railway's log tail. In production, the structured JSON logs would feed into Datadog / Grafana Loki with an alert on error rate > 1%.

### Database Backup & Recovery

| Concern | Strategy |
|---|---|
| Backup cadence | Railway Postgres performs automatic daily backups with 7-day retention (included on paid tier; assessment uses free tier with manual `pg_dump` before seeding) |
| Point-in-time recovery | Not available on Railway free tier; acknowledged limitation |
| Restore drill | `pg_restore` into a local Postgres instance using the Railway backup dump; documented in README |
| Data loss window (RPO) | ~24 hours on free tier (daily backup); acceptable for assessment |
| Recovery time (RTO) | < 30 minutes from dump restore |

### Migration Safety

- Migrations run via `prisma migrate deploy` (not `dev`) in Railway's start command — applies pending migrations only, no schema reset
- All migrations are **additive-first**: new columns are `nullable` or have defaults so old application code continues to work during a rolling deploy
- The `btree_gist` extension creation is idempotent (`CREATE EXTENSION IF NOT EXISTS`)
- The exclusion constraint and GiST index creation are wrapped in a single migration transaction; if it fails, no partial state is left
- For multi-instance safety: Railway runs a single instance; if horizontal scaling is needed, migrations should be run as a one-off pre-deploy job, not in the app startup path

### Security Controls Summary

| Control | Implementation |
|---|---|
| Authentication | JWT (short-lived) + httpOnly cookie refresh with rotation |
| Authorization | Role-based middleware + location-scoped middleware on every relevant route |
| CSRF | Double-submit CSRF token on cookie-mutating endpoints |
| SQL injection | Prisma parameterized queries (no raw SQL with user input) |
| Secrets | Environment variables only; never committed to repo |
| CORS | Strict origin allowlist; no wildcard |
| Rate limiting | `express-rate-limit`: 20 req/min on `/auth/login` to prevent brute force; 200 req/min on general API |

---

## 15. Deployment Plan

### Services
| Service | Provider | Notes |
|---|---|---|
| Frontend | Vercel | Auto-deploy from `main` branch |
| Backend API + Socket.io | Railway | Single Node.js service |
| PostgreSQL | Railway add-on | Managed Postgres |
| Redis | Railway add-on | Upstash Redis or Railway Redis |

### Environment Variables (Backend)
```
DATABASE_URL
REDIS_URL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
FRONTEND_URL          # For CORS
NODE_ENV
PORT
```

### CI/CD
- Push to `main` → Railway redeploys backend, Vercel redeploys frontend
- Migrations run automatically via `prisma migrate deploy` in Railway's start command

---

## 16. Ambiguity Resolutions

The following deliberate ambiguities are resolved as below. These decisions will be documented in the final README.

### 1. Historical data when staff is de-certified from a location

**Decision:** Soft revocation. The `LocationCertification` record gets a `revokedAt` timestamp rather than being deleted. Historical `ShiftAssignment` records remain intact and visible in audit logs and reports. Future assignments to that location are blocked. Past shifts display with a "(certification revoked)" annotation in history views.

**Rationale:** Payroll, legal, and fairness reports need accurate historical data. Deleting the link would corrupt records.

### 2. How "desired hours" interact with availability windows

**Decision:** Desired hours are advisory only — a target number displayed in the fairness report ("Maria wants 30h, currently assigned 18h"). They do NOT restrict assignment. A manager can assign someone beyond their desired hours with a warning, but cannot assign someone outside their availability window. Availability is a hard constraint; desired hours are a scheduling goal.

**Rationale:** Availability represents "I cannot work then" (hard boundary). Desired hours represent "I'd prefer X hours of work" (soft preference). Conflating them would prevent managers from filling critical gaps.

### 3. Does a 1-hour shift count the same as 11-hour for consecutive days?

**Decision:** Yes. Any shift of any duration on a calendar day counts as a "worked day" for consecutive day calculation. The calendar day is determined by the location's timezone (a shift starting at 11pm counts for that day, not the next).

**Rationale:** Labor law consecutive-day rules are typically based on whether a person worked on a given day, not the hours worked. This is the most conservative (legally safe) interpretation.

### 4. Shift edited after swap approval but before it occurs

**Decision:** The swap is kept in its current state (`APPROVED`). The editing manager sees a warning: "This shift has an approved swap — [Staff A] is scheduled to take this shift. Editing will notify all parties." After the edit:
- If times/location change: all parties (original staff, swap recipient, manager who approved) are notified via `swap:updated` event and in-app notification
- If the edit would violate the swap recipient's constraints (e.g., new time conflicts with their existing shift): the edit is blocked with an explanation, and the manager must first cancel the swap before editing

**Rationale:** The swap recipient now has a binding commitment; silently breaking their schedule would be unfair. They must be notified or the edit must be blocked.

### 5. Location spanning a timezone boundary

**Decision:** Each location has exactly one canonical IANA timezone — the timezone where the front door is located. There is no support for "split-timezone" locations. If a real scenario arose, it would be handled as two separate locations.

**Rationale:** Timezone-boundary restaurants are extremely rare. The complexity of supporting them within the 72-hour window is not justified. The decision is explicitly documented.

### 6. Cross-location assignment scope: managers vs. admins

**Question:** Can a manager assign staff to a shift at a location they don't manage, as long as the staff member is certified there?

**Decision:** No. Managers can only create shifts and assign staff at locations they are explicitly assigned to manage (`LocationManager` record exists). This is enforced by the `requireLocationAccess` middleware on all shift/assignment mutation routes. Only Admins can make cross-location assignments.

**Rationale:** The requirement explicitly states "Managers can only see/manage locations they're assigned to." Allowing them to assign staff to another manager's location would undermine the location ownership model and create coordination conflicts.

### 7. Last headcount slot: concurrent claim policy

**Question:** When two managers simultaneously try to fill the last available headcount slot for a shift, what happens?

**Decision:** First write wins. The `SELECT ... FOR UPDATE` on the shift row plus the headcount count-check inside the transaction serializes concurrent inserts for the same shift. Whichever transaction commits first fills the slot; the second transaction's count check sees `count >= headcount` and returns a 409 with message: "This shift is now fully staffed — the last slot was just filled by another manager." No partial or double-fill is possible.

**Rationale:** The DB transaction with row-level lock is the correct primitive here. It's deterministic, correct, and requires no distributed coordination beyond what Postgres already provides.

### 8. Audit log immutability

**Question:** Are audit logs immutable/compliance-grade (append-only/WORM) or operational logs only?

**Decision:** Append-only by application design — no `UPDATE` or `DELETE` is ever issued against the `audit_logs` table in application code. There is no DB-level WORM constraint in this implementation (that would require a PostgreSQL row-security policy or an external immutable store). For this assessment, the audit log is considered operationally immutable: the code enforces append-only access and the Admin export endpoint provides the full record. If compliance-grade immutability were required in production, the logs would be streamed to an append-only store (e.g., S3 + Object Lock, or a dedicated audit service).

---

## Implementation Order (Suggested)

Given the 72-hour constraint, the build order prioritizes core blocking requirements:

| Phase | Duration | Deliverables |
|---|---|---|
| **Phase 1** | Hours 1-6 | Monorepo setup, DB schema, Prisma migrations, auth (login/JWT/refresh), seed script skeleton |
| **Phase 2** | Hours 6-18 | Constraint Engine, shift CRUD, assignment API, swap/drop API, notification model |
| **Phase 3** | Hours 18-28 | React app: auth, schedule calendar, shift detail, assignment with constraint feedback, swap queue |
| **Phase 4** | Hours 28-38 | Socket.io real-time: schedule updates, swap events, conflict detection, on-duty board |
| **Phase 5** | Hours 38-48 | Analytics: overtime dashboard, what-if, fairness report; BullMQ jobs (expiry, reminders) |
| **Phase 6** | Hours 48-58 | Notification center, audit trail UI, admin panel, notification preferences |
| **Phase 7** | Hours 58-66 | Seed data (all evaluation scenarios covered), polish, edge case hardening |
| **Phase 8** | Hours 66-72 | Deploy to Railway + Vercel, smoke test all evaluation scenarios, write README |

---

*This document will be updated as implementation decisions are made.*
