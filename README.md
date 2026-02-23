# ShiftSync — Multi-Location Staff Scheduling Platform

A full-stack scheduling system built for Coastal Eats, a restaurant group operating 4 locations across 2 US timezones. Built for the Priority Soft Full-Stack Developer Assessment.

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 14+
- Redis 6+

### Setup

```bash
# Install dependencies
pnpm install

# Copy and populate env files
cp packages/backend/.env.example packages/backend/.env

# Edit packages/backend/.env with your DB/Redis URLs

# Run database migrations
pnpm --filter @shiftsync/backend exec prisma migrate deploy

# Seed with realistic test data
pnpm --filter @shiftsync/backend prisma:seed

# Start backend (port 4000) and frontend (port 5173)
pnpm --filter @shiftsync/backend dev
pnpm --filter @shiftsync/frontend dev
```

---

## Login Credentials

All passwords are set by the seed script.

| Role | Email | Password | Access |
|------|-------|----------|--------|
| **Admin** | `admin@shiftsync.local` | `ChangeMe123!` | All locations, all features |
| **Manager (LA)** | `alice.manager@shiftsync.local` | `Manager1234!` | Venice Beach + Santa Monica |
| **Manager (FL)** | `bob.manager@shiftsync.local` | `Manager1234!` | Miami Beach + South Beach |
| **Staff** | `carol.smith@shiftsync.local` | `Staff1234!` | Bartender + Server at 3 locations |
| **Staff (overtime)** | `emma.williams@shiftsync.local` | `Staff1234!` | Certified all 4 locations; 32h already this week |
| **Staff (TZ tangle)** | `henry.wilson@shiftsync.local` | `Staff1234!` | LA-only availability (9am–5pm); certified at Venice + Santa Monica only |

---

## Pre-Seeded Test Scenarios

### The Overtime Trap
Emma Williams already has 32 confirmed hours this week (Mon–Thu at Miami Beach). Assigning her to any additional shift will trigger `WARNING` (35h+) or `OVER_LIMIT` (40h+). Use the **What-If** panel on any shift detail page with Emma's user ID to visualise the projected impact before confirming.

### The Timezone Tangle
Henry Wilson's availability is set as Mon–Fri, 9am–5pm **America/Los_Angeles**. If a manager tries to assign Henry to a Miami Beach shift at 9am Eastern Time, that converts to 6am LA time — outside his 9am window — triggering an AVAILABILITY constraint violation.

### The Fairness Complaint
On the **Analytics → Fairness** page, filter by the current week. Carol Smith and Frank Brown hold all Fri/Sat evening (premium) shifts at Venice Beach. Grace Davis and David Jones have 0 premium shifts. The **Fairness Score** will reflect this inequity.

### The Simultaneous Assignment
Open two browser windows as Alice and Bob (or two different manager accounts) and attempt to assign the same bartender to different shifts at the same time. The second request will receive a `conflict:detected` real-time notification.

### The Regret Swap
Log in as Carol, navigate to **Swaps & Drops**, create a SWAP request targeting another staff member. While it's `PENDING_ACCEPTANCE`, hit **Cancel** — the request transitions to `CANCELLED` with no assignment change. If the manager had already viewed it, they receive a `swap:cancelled` notification.

### The Sunday Night Chaos
A staff member calls out on Sunday for a 7pm shift. The fastest path:
1. Manager opens the shift detail → removes the absent staff member's assignment
2. Checks **On-Duty Now** on the dashboard for currently available staff
3. Uses the **What-If** panel to screen replacements for overtime impact
4. Assigns a replacement directly from the shift detail page
5. Publishes the change — staff receive real-time `schedule:updated` notification

---

## Feature Coverage

| Requirement | Status |
|-------------|--------|
| User roles (Admin / Manager / Staff) | ✅ Full RBAC + location-based access |
| Shift CRUD with constraint enforcement | ✅ 11 constraint rules, override paths documented |
| Schedule publish / unpublish with cutoff | ✅ 48h cutoff enforced |
| Swap & drop request workflow | ✅ Full FSM with expiry (BullMQ) |
| Overtime & labor law compliance | ✅ Daily (8h warn, 12h hard) + weekly (35h warn, 40h hard) + consecutive days |
| What-if analysis before assignment | ✅ Per-shift projected hours + consecutive days |
| Schedule fairness analytics | ✅ Distribution report + premium equity score |
| Weekly overtime dashboard | ✅ Per-location weekly risk summary |
| Real-time updates (Socket.io) | ✅ Schedule, swap, on-duty, conflict events |
| On-duty now board | ✅ Live, per-location, timezone-correct |
| Concurrent conflict detection | ✅ Redis advisory lock + socket notification |
| Notification center (in-app) | ✅ Unread badge, popover, mark-all-read |
| Notification preferences | ✅ in-app + email simulation toggles |
| Audit trail (all schedule changes) | ✅ Full before/after JSON, filterable by location/date/type |
| User management (admin/manager) | ✅ Create, deactivate, skill & cert management |
| Staff availability windows | ✅ Per day-of-week + timezone, DST-safe |
| Multi-timezone display | ✅ All times in location timezone via date-fns-tz |
| Refresh token rotation + CSRF | ✅ Redis family tracking + double-submit CSRF token |

---

## Ambiguity Resolutions (per assessment)

**Q: What happens to historical data when a staff member is de-certified?**
The `revokedAt` timestamp is set on their `LocationCertification`. All historical assignments and audit logs are preserved. Future constraint checks use `WHERE revokedAt IS NULL`.

**Q: How should "desired hours" interact with availability windows?**
`desiredWeeklyHours` is a soft target shown in the fairness report (over/under-scheduled visibility). It does not create a hard constraint — managers may schedule above or below it. The constraint engine only enforces hard overtime limits (40h/week, 12h/day).

**Q: When calculating consecutive days, does a 1-hour shift count the same as an 11-hour shift?**
Yes. Any shift on a calendar day counts as one day worked for the purpose of consecutive-day tracking. This follows typical labor law interpretation.

**Q: If a shift is edited after swap approval but before it occurs, what happens?**
Any pending swap requests for that shift are automatically cancelled with a `swap:cancelled` notification to all parties. If the swap was already `APPROVED`, the assignment reverts to `CONFIRMED` on the original staff member (the swap approval is not retroactively undone — that edge case is documented as a known limitation).

**Q: How should the system handle a location near a timezone boundary?**
Each location has a single canonical timezone (stored in `locations.timezone`). The constraint engine and calendar always use this timezone. A multi-timezone location would need to be modelled as two separate locations — this is a known limitation noted in the data model.

---

## Architecture

- **Monorepo**: pnpm workspaces (`shared`, `backend`, `frontend`)
- **Backend**: Express + TypeScript + Prisma + PostgreSQL + Redis + Socket.io + BullMQ
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + React Query + Zustand
- **Auth**: JWT (15m access) + httpOnly refresh cookie (7d) + CSRF double-submit
- **Real-time**: Socket.io with Redis adapter (multi-instance ready)
- **Jobs**: BullMQ worker for drop request expiry

Full technical design: see [`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)
