# ShiftSync — Cypress E2E Test Plan

## Overview

This document defines the complete Cypress end-to-end test suite for ShiftSync. Each test case includes preconditions, exact steps, expected outcomes, and seed data references so a QA engineer can implement them directly.

**Base URL:** `http://localhost:5173`  
**API Base:** `http://localhost:4000/api/v1`  
**Test environment:** Development (seed data loaded via `pnpm --filter @shiftsync/backend prisma:seed`)

---

## Seed Accounts Reference

| Handle | Email | Password | Role | Notes |
|--------|-------|----------|------|-------|
| `ADMIN` | admin@shiftsync.local | ChangeMe123! | Admin | Full access |
| `MGR_LA` | alice.manager@shiftsync.local | Manager1234! | Manager | Venice + Santa Monica |
| `MGR_FL` | bob.manager@shiftsync.local | Manager1234! | Manager | Miami + South Beach |
| `CAROL` | carol.smith@shiftsync.local | Staff1234! | Staff | Bartender+Server, 3 locations |
| `EMMA` | emma.williams@shiftsync.local | Staff1234! | Staff | 32h already this week |
| `HENRY` | henry.wilson@shiftsync.local | Staff1234! | Staff | LA availability 9-17h only |
| `FRANK` | frank.brown@shiftsync.local | Staff1234! | Staff | Bartender, Venice+SouthBeach |
| `GRACE` | grace.davis@shiftsync.local | Staff1234! | Staff | Host+Server, SantaMonica+Miami |
| `DAVID` | david.jones@shiftsync.local | Staff1234! | Staff | LineCook, Miami+SouthBeach |

---

## Cypress Configuration Notes

```javascript
// cypress.config.js suggestions
baseUrl: 'http://localhost:5173',
viewportWidth: 1280,
viewportHeight: 800,
defaultCommandTimeout: 8000,
video: true,
```

Recommended custom commands to define:
- `cy.login(email, password)` — POST to `/auth/login`, store token in localStorage via the app's auth flow
- `cy.loginAs(handle)` — shorthand using seed account credentials
- `cy.interceptGQL(alias, method, url)` — alias common API calls
- `cy.resetSeed()` — optional `beforeEach` hook calling a test-only reset endpoint (if implemented)

---

---

## SUITE 1 — Authentication (`auth/`)

### AUTH-001 — Successful login (Staff)
**Role:** Unauthenticated  
**Preconditions:** App loaded at `/login`

**Steps:**
1. Navigate to `/login`
2. Verify the page title contains "ShiftSync"
3. Enter `carol.smith@shiftsync.local` in the email field
4. Enter `Staff1234!` in the password field
5. Click the "Sign In" button
6. Wait for navigation

**Expected:**
- Redirected to `/dashboard`
- Topbar shows "Carol Smith"
- Role badge displays "Staff"
- Navigation includes: Dashboard, Schedule, Swaps, Availability
- Navigation does NOT include: Users, Analytics, Audit

---

### AUTH-002 — Successful login (Manager)
**Role:** Unauthenticated

**Steps:**
1. Navigate to `/login`
2. Enter `alice.manager@shiftsync.local` / `Manager1234!`
3. Click "Sign In"

**Expected:**
- Redirected to `/dashboard`
- Navigation includes: Dashboard, Schedule, Swaps, Users, Analytics, Audit
- Navigation does NOT include: Availability (manager-specific omission)
- Welcome banner shows "Alice Nguyen"
- Role badge shows "Manager"

---

### AUTH-003 — Invalid credentials
**Role:** Unauthenticated

**Steps:**
1. Navigate to `/login`
2. Enter `carol.smith@shiftsync.local` and `WrongPassword!`
3. Click "Sign In"

**Expected:**
- Remain on `/login`
- Error message visible (e.g., "Invalid credentials" or similar)
- No redirect occurs

---

### AUTH-004 — Session persistence on page refresh
**Role:** Any authenticated

**Steps:**
1. Login as `CAROL`
2. Confirm `/dashboard` is loaded
3. Call `cy.reload()`
4. Wait for app to rehydrate

**Expected:**
- User remains on `/dashboard` (or the current route)
- NOT redirected to `/login`
- User name still visible in topbar

---

### AUTH-005 — Logout
**Role:** Any authenticated

**Steps:**
1. Login as `CAROL`
2. Navigate to `/dashboard`
3. Click the logout button/icon in the topbar
4. Confirm logout action (if a confirmation dialog appears)

**Expected:**
- Redirected to `/login`
- Revisiting `/dashboard` redirects back to `/login` (session cleared)
- Access token cleared from memory

---

### AUTH-006 — Protected route redirect (unauthenticated)
**Role:** Unauthenticated

**Steps:**
1. Without logging in, navigate directly to `/dashboard`

**Expected:**
- Redirected to `/login`

---

### AUTH-007 — Role guard: Staff cannot access Manager routes
**Role:** Staff (CAROL)

**Steps:**
1. Login as `CAROL`
2. Navigate directly to `/users`
3. Navigate directly to `/analytics`
4. Navigate directly to `/audit`

**Expected:**
- Each URL either redirects to `/dashboard` or shows a 403/forbidden state
- No user management data is displayed

---

---

## SUITE 2 — Dashboard (`dashboard/`)

### DASH-001 — Dashboard stat cards visible
**Role:** Manager (MGR_LA)

**Steps:**
1. Login as `MGR_LA`
2. Navigate to `/dashboard`

**Expected:**
- Welcome banner shows "Alice Nguyen"
- Three stat cards visible: "ShiftSync", "4 Locations", "Notifications"
- Overtime Risk widget visible with a location selector
- Notification Preferences card visible

---

### DASH-002 — Staff dashboard is simpler
**Role:** Staff (CAROL)

**Steps:**
1. Login as `CAROL`
2. Navigate to `/dashboard`

**Expected:**
- Welcome banner shows "Carol Smith"
- Notification Preferences card visible
- Overtime Risk widget NOT visible
- On-Duty Board NOT visible

---

### DASH-003 — Overtime Risk widget — select location
**Role:** Manager (MGR_LA)

**Steps:**
1. Login as `MGR_LA`
2. On `/dashboard`, locate the "Overtime Risk" widget
3. Select "Coastal Eats - Miami Beach" from the location dropdown

**Expected:**
- Widget loads staff overtime data
- "Emma Williams" appears with weekly hours close to or at 32h
- Her risk badge shows "Warning" or similar elevated status

---

### DASH-004 — Notification preferences toggle
**Role:** Any authenticated (CAROL)

**Steps:**
1. Login as `CAROL`
2. On `/dashboard`, find "Notification Preferences"
3. Toggle "Email simulation" checkbox on
4. Observe immediate save (no separate save button needed)
5. Reload the page

**Expected:**
- After reload, "Email simulation" remains checked
- Toggle is persisted via PUT `/users/me/notification-preferences`

---

---

## SUITE 3 — Schedule Calendar (`schedule/`)

### SCHED-001 — Calendar renders for a location
**Role:** Manager (MGR_LA)

**Steps:**
1. Login as `MGR_LA`
2. Navigate to `/schedule`
3. Select "Coastal Eats - Venice Beach" from the Location dropdown
4. Verify the week selector shows the current week

**Expected:**
- FullCalendar renders in week view
- Shifts seeded for Venice Beach appear as calendar events
- The calendar title shows the correct week range
- Published shifts are visible; Draft shifts may show differently

---

### SCHED-002 — Calendar respects timezone
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to `/schedule`
2. Select "Coastal Eats - Miami Beach" (ET timezone)
3. Note the start times of Monday shifts

**Expected:**
- Miami shifts show at 9:00 AM local time (ET)
- Subtitle or description shows "America/New_York"

---

### SCHED-003 — Week navigation
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to `/schedule?locationId={VENICE_ID}`
2. Change the "Week starting" date input to next Monday
3. Observe calendar update

**Expected:**
- Calendar advances to the selected week
- URL query string updates with new `week` parameter
- If no shifts exist for next week, calendar shows empty days

---

### SCHED-004 — Create Shift modal (Manager)
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to `/schedule`
2. Click the "+ Create Shift" button
3. Select location "Coastal Eats - Venice Beach"
4. Select skill "Server"
5. Set Start time to next Tuesday at 10:00 AM local
6. Set End time to next Tuesday at 04:00 PM local
7. Set Headcount to 2
8. Click "Create Shift"

**Expected:**
- Modal closes
- New shift appears on the calendar for next Tuesday
- Shift is in DRAFT status (not yet published)
- Audit log records a CREATE event for this shift

---

### SCHED-005 — Create Shift validation — end before start
**Role:** Manager (MGR_LA)

**Steps:**
1. Open "+ Create Shift"
2. Set Start time to Tuesday 5:00 PM
3. Set End time to Tuesday 8:00 AM (before start)
4. Click "Create Shift"

**Expected:**
- Request fails
- Error message displayed inside modal: "startTime must be before endTime"
- Modal remains open

---

### SCHED-006 — Create Shift blocked for Staff
**Role:** Staff (CAROL)

**Steps:**
1. Login as `CAROL`
2. Navigate to `/schedule`

**Expected:**
- "+ Create Shift" button is NOT visible

---

### SCHED-007 — Premium shift auto-tagged
**Role:** Manager (MGR_LA)

**Steps:**
1. Open "+ Create Shift"
2. Select Venice Beach, skill Bartender
3. Set start to Friday 5:00 PM local (LA), end Friday 11:00 PM local
4. Click "Create Shift"
5. Click the newly created shift event on the calendar

**Expected:**
- Shift detail shows `isPremium: true` or a "Premium" badge
- This is automatically computed by the backend (Friday 17:00+ in LA timezone)

---

---

## SUITE 4 — Shift Detail & Assignments (`shifts/`)

### SHIFT-001 — View shift detail
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to `/schedule`, select Venice Beach
2. Click an existing published shift (e.g., Monday Server shift)

**Expected:**
- Navigated to `/shifts/:id`
- Shift shows: location name, skill, start/end times, headcount, status badge
- Current assignments section shows assigned staff (Carol Smith, Henry Wilson)
- Each assignment has a "Remove" or "Unassign" button

---

### SHIFT-002 — Assign staff to shift (happy path)
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to a published shift at Venice Beach with open slots (e.g., Friday Bartender — 2 slots, 2 already assigned; find one with a free slot or use a newly created shift)
2. Use the "Assign Staff" section
3. Enter or select Frank Brown's user ID
4. Click "Assign"

**Expected:**
- Frank Brown appears in the assignments list
- Headcount slot counter decrements
- Socket event may trigger a `schedule:updated` notification

---

### SHIFT-003 — Assign staff — skill mismatch blocked
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to a Server shift at Venice Beach
2. Attempt to assign David Jones (David only has "Line Cook" skill, not "Server")
3. Click "Assign"

**Expected:**
- Response is 422 Unprocessable Entity
- Constraint feedback panel shows: rule SKILL_MISMATCH, severity BLOCKING
- David Jones is NOT added to the assignments list

---

### SHIFT-004 — Assign staff — certification check
**Role:** Manager (MGR_FL)

**Steps:**
1. Navigate to a Miami Beach shift (e.g., Monday Server shift)
2. Attempt to assign Henry Wilson (Henry is NOT certified for Miami Beach — only Venice + Santa Monica)
3. Click "Assign"

**Expected:**
- 422 response
- Constraint violation: LOCATION_NOT_CERTIFIED, BLOCKING
- Henry NOT added

---

### SHIFT-005 — Assign staff — overtime warning (Emma, 32h + 8h shift)
**Role:** Manager (MGR_FL)

**Steps:**
1. Navigate to the Miami Saturday Server shift (6h, PREMIUM, currently unassigned to Emma)
2. Assign Emma Williams
3. Observe response

**Expected:**
- Assignment may succeed (38h total = WARNING, not BLOCKING)
- Constraint feedback shows WARNING: weekly hours will reach 38h
- Emma IS added (warnings don't block by default)
- The "What-If" panel shows projectedWeeklyHours = 38

---

### SHIFT-006 — Assign staff — overtime HARD LIMIT blocked
**Role:** Manager (MGR_FL)

**Steps:**
1. Find or create an 8h+ shift at Miami Beach for the same week
2. Attempt to assign Emma (who already has 32h + any additional hours that would push total over 40h)

**Expected:**
- 422 response
- Constraint violation: WEEKLY_HARD_LIMIT, BLOCKING
- Emma NOT assigned

---

### SHIFT-007 — What-If panel projections
**Role:** Manager (MGR_FL)

**Steps:**
1. Navigate to any Miami Beach shift
2. Open the "What-If" panel (if it requires a staffId input, enter Emma's user ID)
3. Submit the analysis

**Expected:**
- Panel shows: currentWeeklyHours (32), projectedWeeklyHours (32 + shift hours)
- overtimeRisk label matches the projected total (WARNING if 35–40h, OVER_LIMIT if >40h)
- consecutiveDays shows a number ≥ 1
- warnings array lists relevant messages

---

### SHIFT-008 — Unassign staff from shift
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to Venice Beach Monday Server shift
2. Click "Remove" next to Carol Smith
3. Confirm if a dialog appears

**Expected:**
- Carol removed from the assignment list
- Headcount slot counter increments (one slot now open)
- Audit log records UNASSIGN for this shift/user

---

### SHIFT-009 — Publish shift
**Role:** Manager (MGR_LA)

**Steps:**
1. Create a new DRAFT shift at Venice Beach
2. Navigate to the shift detail
3. Click "Publish"

**Expected:**
- Status badge changes from "Draft" to "Published"
- `publishedAt` timestamp appears
- Real-time: any staff assigned receive a `schedule:updated` notification
- Audit log records a PUBLISH action

---

### SHIFT-010 — Cancel shift
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to a published shift with no assignments (or create one)
2. Click "Cancel Shift"
3. Confirm cancellation

**Expected:**
- Status badge changes to "Cancelled"
- The shift appears greyed-out or removed from calendar active view
- Any existing assignments are handled (notification sent to assigned staff)

---

---

## SUITE 5 — Constraint Engine (`constraints/`)

### CON-001 — Consecutive days — 6th day warning
**Role:** Manager (MGR_FL)

**Preconditions:** Create 5 consecutive daily shifts at Miami Beach and assign Emma to all of them (or use a custom test account)

**Steps:**
1. Navigate to the 6th consecutive day shift for that staff member
2. Attempt to assign them

**Expected:**
- Constraint feedback shows WARNING: "6th consecutive day worked — consider rest"
- Assignment proceeds (warning, not block)

---

### CON-002 — Rest period between shifts (< 10h gap)
**Role:** Manager (MGR_LA)

**Preconditions:** Carol is assigned Venice Monday 9am–5pm (ends 5pm LA / 01:00 UTC Tuesday)

**Steps:**
1. Create a Venice shift for Monday 10:00 PM to Tuesday 6:00 AM (within 10h of Carol's previous shift)
2. Attempt to assign Carol

**Expected:**
- 422 response
- Constraint violation: REST_PERIOD_VIOLATED, BLOCKING
- "Minimum 10-hour rest between shifts is required"

---

### CON-003 — Daily hours hard limit (>12h/day)
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to Venice Beach on a day where a staff member already has an 8h shift
2. Create a second shift the same day (overlapping or adjacent, making total > 12h)
3. Assign the same staff member to both shifts

**Expected:**
- 422 response
- Constraint violation: DAILY_HARD_LIMIT, BLOCKING

---

### CON-004 — Availability violation (Henry, timezone tangle)
**Role:** Manager (MGR_FL)

**Preconditions:** Henry has 9am–5pm availability in America/Los_Angeles. A Miami Beach shift starts at 9am ET = 6am LA.

**Steps:**
1. Navigate to the Miami Monday 9am ET Server shift
2. Attempt to assign Henry Wilson

**Expected:**
- 422 response
- Constraint violation: AVAILABILITY_MISMATCH or OUTSIDE_AVAILABILITY_WINDOW, BLOCKING
- "Henry's availability is 09:00–17:00 America/Los_Angeles; shift starts at 06:00 LA time"

---

### CON-005 — Manager override with reason
**Role:** Manager (MGR_LA)

**Preconditions:** A BLOCKING constraint exists (e.g., CON-004 scenario)

**Steps:**
1. Trigger the constraint violation (assign Henry to Miami shift)
2. See the 422 response with violations listed
3. Re-submit the assignment with `override: true` and `overrideReason: "Emergency coverage needed"`

**Expected:**
- Assignment succeeds (201)
- A ManagerOverride record is created
- Audit log records the override
- Warning notification is visible in the constraint feedback

---

---

## SUITE 6 — Swap & Drop Requests (`swap-requests/`)

### SWAP-001 — Create a SWAP request
**Role:** Staff (CAROL)

**Preconditions:** Carol is assigned to Venice Monday Server shift

**Steps:**
1. Login as `CAROL`
2. Navigate to `/swap-requests`
3. In "Request a Swap", select the Venice Monday assignment
4. Select a target staff member (e.g., Emma Williams)
5. Click "Request Swap"

**Expected:**
- Swap request appears in "My Requests" section with status `PENDING_ACCEPTANCE`
- Emma sees the request in her "Incoming Swaps" section

---

### SWAP-002 — Accept a SWAP request
**Role:** Staff (EMMA), after SWAP-001

**Steps:**
1. Login as `EMMA`
2. Navigate to `/swap-requests`
3. In "Incoming Swaps", find Carol's request
4. Click "Accept"

**Expected:**
- Request status changes to `PENDING_MANAGER`
- Request moves out of "Incoming Swaps" and into history
- Manager sees a pending approval in their queue

---

### SWAP-003 — Manager approves SWAP
**Role:** Manager (MGR_LA), after SWAP-002

**Steps:**
1. Login as `MGR_LA`
2. Navigate to `/swap-requests`
3. Find the pending manager approval
4. Click "Approve" (optionally enter a note)

**Expected:**
- Swap status becomes `APPROVED`
- Carol's assignment is now `SWAPPED`
- Emma gains a new assignment for that shift
- Both Carol and Emma receive `SWAP_APPROVED` notification

---

### SWAP-004 — Manager rejects SWAP
**Role:** Manager (MGR_LA)

**Steps:**
1. Repeat steps to get a swap to `PENDING_MANAGER`
2. Click "Reject" with reason "Not enough notice"

**Expected:**
- Swap status becomes `REJECTED`
- Carol's assignment remains `CONFIRMED`
- Emma receives `SWAP_REQUEST_REJECTED` notification

---

### SWAP-005 — Cancel a SWAP before acceptance (Regret Swap)
**Role:** Staff (CAROL)

**Steps:**
1. Login as `CAROL`, create a swap request targeting Emma (PENDING_ACCEPTANCE)
2. Before Emma accepts, click "Cancel" on the request

**Expected:**
- Request status changes to `CANCELLED`
- Emma no longer sees the incoming request
- Carol's shift assignment is unchanged

---

### SWAP-006 — Create a DROP request
**Role:** Staff (CAROL)

**Preconditions:** Carol is assigned to Venice Friday PM Bartender shift

**Steps:**
1. Login as `CAROL`
2. Navigate to `/swap-requests`
3. In "Request a Drop", select the Friday PM assignment
4. Click "Request Drop"

**Expected:**
- Drop request appears with status `OPEN`
- Request is visible in "Available Drops" section for other eligible staff
- BullMQ schedules an expiry job

---

### SWAP-007 — Another staff picks up a DROP
**Role:** Staff (FRANK), after SWAP-006

**Preconditions:** Frank is certified at Venice Beach and has Bartender skill

**Steps:**
1. Login as `FRANK`
2. Navigate to `/swap-requests`
3. Find Carol's available drop for Venice Friday PM
4. Click "Pick Up Shift"

**Expected:**
- Status changes to `PENDING_MANAGER`
- Frank's name appears as the pickup candidate
- Manager sees a pending approval

---

### SWAP-008 — DROP request expires (BullMQ)
**Role:** Manager (MGR_LA)

**Preconditions:** Create a drop request with a very short expiry (requires test-only endpoint or manual DB manipulation, or wait for the configured expiry time)

**Steps:**
1. Create a drop request
2. Wait for the BullMQ expiry job to run
3. Refresh the swap requests page

**Expected:**
- Drop request status changes to `EXPIRED`
- Carol's original assignment reverts to `CONFIRMED`
- Carol receives `SWAP_REQUEST_CANCELLED` notification

---

---

## SUITE 7 — User Management (`users/`)

### USER-001 — View user list (Admin)
**Role:** Admin

**Steps:**
1. Login as `ADMIN`
2. Navigate to `/users`

**Expected:**
- Table shows all 9 seeded users
- Each row shows: name, email, role badge, skills, certifications, active status
- Search input is visible

---

### USER-002 — Search/filter users
**Role:** Admin

**Steps:**
1. Navigate to `/users`
2. Type "emma" in the search box

**Expected:**
- Only Emma Williams is visible in the table
- Other rows are filtered out

---

### USER-003 — Expand user row to see skills and certifications
**Role:** Admin

**Steps:**
1. Navigate to `/users`
2. Click on the row for Emma Williams to expand it

**Expected:**
- Expanded row shows skill toggle chips: "✓ Server", "✓ Host", "+ Bartender", "+ Line Cook"
- Location cert chips: "✓ Venice Beach", "✓ Santa Monica", "✓ Miami Beach", "✓ South Beach"
- Actions section shows "Deactivate" button

---

### USER-004 — Add skill to user
**Role:** Admin or Manager

**Steps:**
1. Navigate to `/users`
2. Expand David Jones' row
3. Click "+ Bartender" chip (David currently has only Line Cook)

**Expected:**
- API call to `POST /users/:id/skills` fires
- Chip changes to "✓ Bartender" immediately
- Row refreshes; David now has 2 skills

---

### USER-005 — Remove skill from user
**Role:** Admin or Manager

**Steps:**
1. Expand David Jones' row (after USER-004)
2. Click "✓ Bartender" to remove it

**Expected:**
- API call to `DELETE /users/:id/skills/:skillId` fires
- Chip returns to "+ Bartender"

---

### USER-006 — Grant location certification
**Role:** Admin or Manager

**Steps:**
1. Expand Henry Wilson's row
2. Click "+ Miami Beach" (Henry is currently not certified for Miami)

**Expected:**
- API call to `POST /users/:id/certifications`
- Chip changes to "✓ Miami Beach"
- Henry now eligible for Miami shifts

---

### USER-007 — Revoke location certification
**Role:** Admin or Manager

**Steps:**
1. Expand Henry Wilson's row (after USER-006)
2. Click "✓ Miami Beach"

**Expected:**
- API call to `DELETE /users/:id/certifications/:locationId`
- `revokedAt` timestamp set; Henry no longer certified
- Chip returns to "+ Miami Beach"

---

### USER-008 — Create new user
**Role:** Admin

**Steps:**
1. Navigate to `/users`
2. Click "+ Add User"
3. Fill in: First name "Test", Last name "Staff", Email "test.staff@shiftsync.local", Password "TestPass123!", Role "Staff", Desired hrs/week 32
4. Click "Create User"

**Expected:**
- Modal closes
- "Test Staff" appears in the user list
- Role badge shows "Staff"
- Desired hours shows 32h

---

### USER-009 — Create user — duplicate email rejected
**Role:** Admin

**Steps:**
1. Click "+ Add User"
2. Enter email `carol.smith@shiftsync.local` (already exists)
3. Click "Create User"

**Expected:**
- Error message: "Email already in use"
- Modal remains open
- No duplicate record created

---

### USER-010 — Deactivate user
**Role:** Admin

**Steps:**
1. Expand any staff row
2. Click "Deactivate"

**Expected:**
- Row shows "Inactive" status and becomes visually dimmed (opacity-50)
- Button label changes to "Reactivate"
- User can no longer log in (if login check enforces `isActive`)

---

---

## SUITE 8 — Availability Management (`availability/`)

### AVAIL-001 — View My Availability page (Staff)
**Role:** Staff (HENRY)

**Steps:**
1. Login as `HENRY`
2. Navigate to `/availability`

**Expected:**
- Page shows 7 day rows (Mon–Sun order, Mon first)
- Mon–Fri rows are checked ON with 09:00–17:00, timezone "America/Los_Angeles"
- Sat–Sun rows are unchecked (Unavailable)

---

### AVAIL-002 — Enable a previously-off day
**Role:** Staff (HENRY)

**Steps:**
1. Navigate to `/availability`
2. Check the Saturday checkbox to enable it
3. Set Saturday start to 10:00, end to 16:00
4. Click "Save Availability"

**Expected:**
- "Saved!" success message appears
- Reload the page
- Saturday is now shown as checked with 10:00–16:00

---

### AVAIL-003 — Disable a day
**Role:** Staff (HENRY)

**Steps:**
1. Navigate to `/availability`
2. Uncheck Monday
3. Click "Save Availability"

**Expected:**
- Monday shows "Unavailable"
- Reload: Monday remains unchecked
- Assigning Henry to a Monday shift now triggers AVAILABILITY_MISMATCH

---

### AVAIL-004 — Staff cannot edit another staff's availability
**Role:** Staff (CAROL)

**Steps:**
1. Login as `CAROL`
2. Make a direct API call (or navigate) to `/users/${HENRY_ID}/availability`

**Expected:**
- API returns 403 Forbidden
- Carol cannot view or modify Henry's availability window

---

### AVAIL-005 — Manager can view staff availability
**Role:** Manager (MGR_LA)

**Steps:**
1. Login as `MGR_LA`
2. Make a GET request to `/users/${HENRY_ID}/availability`

**Expected:**
- Returns Henry's availability rows
- 200 response

---

---

## SUITE 9 — Analytics (`analytics/`)

### ANA-001 — Fairness report loads
**Role:** Manager (MGR_FL)

**Steps:**
1. Login as `MGR_FL`
2. Navigate to `/analytics`
3. Leave location as "All locations"
4. Observe the Hours Distribution section

**Expected:**
- At least 6 staff members shown in the distribution bars
- Emma Williams bar is the tallest (most hours, ~32h)
- Staff with 0 hours are NOT shown (they have no confirmed assignments)
- Fairness Score card shows a number 0–100

---

### ANA-002 — Fairness score reflects premium inequity
**Role:** Manager (MGR_LA)

**Steps:**
1. Navigate to `/analytics`
2. Set location to "Coastal Eats - Venice Beach"

**Expected:**
- Carol Smith shows "✦ 1 premium" (Venice Fri PM)
- Frank Brown shows "✦ 1 premium" (Venice Fri PM, 2nd slot)
- Other staff show 0 premium
- Fairness Score is below 100 (inequitable distribution)
- Total Premium Shifts card shows 2

---

### ANA-003 — Overtime Risk table loads per location
**Role:** Manager (MGR_FL)

**Steps:**
1. Navigate to `/analytics`
2. Select "Coastal Eats - Miami Beach" as location
3. Observe the "Weekly Overtime Risk" table

**Expected:**
- Emma Williams row shows ~32h with "Warning" badge
- Grace Davis row shows ~12h with "Low" badge
- Table is sorted by hours descending
- Warning banner appears at the bottom: "One or more staff members are approaching overtime"

---

### ANA-004 — Filter fairness by week
**Role:** Manager (MGR_FL)

**Steps:**
1. Navigate to `/analytics`
2. Change "Fairness: from week" to a week in the past with no data

**Expected:**
- Distribution report shows empty state: "No scheduling data found for the selected period"
- Fairness Score and avg hours reflect 0/empty

---

---

## SUITE 10 — Audit Log (`audit/`)

### AUDIT-001 — Audit log loads with events
**Role:** Admin

**Steps:**
1. Login as `ADMIN`
2. Navigate to `/audit`

**Expected:**
- Table shows audit events (at minimum the seed-created shifts)
- Each row shows: timestamp, actor name, action badge (CREATE/PUBLISH/ASSIGN etc.), entity type, shift/entity reference
- Total event count is shown

---

### AUDIT-002 — Filter by location
**Role:** Admin

**Steps:**
1. Navigate to `/audit`
2. Select "Coastal Eats - Venice Beach" from the location filter

**Expected:**
- Only events related to Venice Beach shifts appear
- Miami Beach events are not shown

---

### AUDIT-003 — Filter by entity type
**Role:** Admin

**Steps:**
1. Navigate to `/audit`
2. Select "ShiftAssignment" from the entity type filter

**Expected:**
- Only assignment events (ASSIGN, UNASSIGN) are shown
- Shift CREATE events are hidden

---

### AUDIT-004 — Filter by date range
**Role:** Admin

**Steps:**
1. Navigate to `/audit`
2. Set "From date" to yesterday and "To date" to today

**Expected:**
- Only events from the last 2 days are shown
- Events older than the range are excluded

---

### AUDIT-005 — Expand a log row to see before/after
**Role:** Admin

**Steps:**
1. Navigate to `/audit`
2. Click an ASSIGN event row to expand it

**Expected:**
- Expanded section shows "After" JSON with the assignment data (userId, shiftId, status, etc.)
- If an UPDATE event, both "Before" and "After" JSON are shown
- JSON is human-readable (pretty-printed)

---

### AUDIT-006 — Pagination
**Role:** Admin

**Preconditions:** More than 50 audit events exist (create/assign/unassign several shifts)

**Steps:**
1. Navigate to `/audit`
2. Verify "Page 1 of N" is shown
3. Click "Next" button

**Expected:**
- Page 2 loads with the next 50 events
- "Previous" button becomes enabled
- Total count remains consistent

---

---

## SUITE 11 — Real-Time / Notifications (`realtime/`)

### RT-001 — Notification bell shows unread count
**Role:** Staff (CAROL)

**Preconditions:** A manager assigns Carol to a new shift after Carol is logged in

**Steps:**
1. Login as `CAROL` in one browser tab
2. In another tab/session, login as `MGR_LA`
3. Assign Carol to a new shift
4. Switch back to Carol's tab (without refreshing)

**Expected:**
- Carol's notification bell increments unread count
- New notification appears in the notification popover

---

### RT-002 — Open notification popover
**Role:** Staff (CAROL, after RT-001)

**Steps:**
1. Click the notification bell icon
2. Observe the popover

**Expected:**
- Popover opens showing recent notifications
- New notification message includes shift details (location, time)
- "Mark all as read" button is visible

---

### RT-003 — Mark all notifications as read
**Role:** Staff (CAROL)

**Steps:**
1. Click the notification bell (at least 1 unread)
2. Click "Mark all as read"

**Expected:**
- Unread count badge disappears from the bell
- All notifications show as read (no unread indicator per-item)

---

### RT-004 — Schedule update propagates without refresh
**Role:** Staff (CAROL)

**Preconditions:** Carol is logged in and has joined the Venice Beach room

**Steps:**
1. Login as `CAROL`, navigate to `/schedule?locationId={VENICE_ID}`
2. In a separate manager session, publish or modify a Venice Beach shift
3. Observe Carol's calendar WITHOUT refreshing

**Expected:**
- The calendar updates automatically (React Query invalidation triggered by socket event)
- New or modified shift appears within a few seconds

---

### RT-005 — Swap notification propagates in real-time
**Role:** EMMA (logged in), after CAROL creates a swap targeting Emma

**Steps:**
1. Login as `EMMA` in one session, stay on `/swap-requests`
2. In another session as `CAROL`, create a swap request targeting Emma
3. Observe Emma's page

**Expected:**
- Emma's "Incoming Swaps" section updates without a page refresh
- Or the unread notification count increments

---

---

## SUITE 12 — On-Duty Board (`on-duty/`)

### ONDUTY-001 — On-Duty Board visible to Managers
**Role:** Manager (MGR_LA)

**Steps:**
1. Login as `MGR_LA`
2. Navigate to `/dashboard`
3. Locate the On-Duty Board section

**Expected:**
- On-Duty Board is visible
- If any shifts are currently in progress, assigned staff are listed
- Location and shift time shown for each on-duty entry

---

### ONDUTY-002 — On-Duty Board hidden from Staff
**Role:** Staff (CAROL)

**Steps:**
1. Login as `CAROL`
2. Navigate to `/dashboard`

**Expected:**
- On-Duty Board component is NOT rendered

---

### ONDUTY-003 — Concurrent manager conflict notification
**Role:** Two Manager sessions simultaneously

**Steps:**
1. Open two browser windows: MGR_LA and MGR_FL (or Admin as both)
2. Both navigate to the same shift detail page at the same time
3. MGR_LA assigns Frank to Slot 1
4. Simultaneously, MGR_FL tries to assign Frank to a different overlapping shift

**Expected:**
- One assignment succeeds
- The second triggers a real-time `conflict:detected` event
- The manager who loses the race sees a toast or notification: "Conflict detected — schedule updated by another manager"

---

---

## SUITE 13 — Navigation & Layout (`nav/`)

### NAV-001 — Active nav item highlighted
**Role:** Manager (MGR_LA)

**Steps:**
1. Login as `MGR_LA`
2. Navigate to `/schedule`
3. Inspect the nav items

**Expected:**
- "Schedule" nav item is highlighted (active state)
- Other nav items are not highlighted

---

### NAV-002 — 404 page for unknown routes
**Role:** Any authenticated

**Steps:**
1. Login as any user
2. Navigate to `/this-does-not-exist`

**Expected:**
- NotFoundPage renders with a clear message
- "Go to Dashboard" button is present and functional

---

### NAV-003 — Mobile layout (viewport 375px)
**Role:** Any authenticated

**Steps:**
1. Set Cypress viewport to 375x667 (`cy.viewport(375, 667)`)
2. Login and navigate to `/dashboard`

**Expected:**
- Layout does not overflow horizontally (no horizontal scroll)
- Nav items remain accessible (may collapse to hamburger or scroll)
- Cards stack vertically

---

---

## SUITE 14 — API Contract Tests (via `cy.request`)

These tests call the API directly to verify contract compliance without UI interaction.

### API-001 — Refresh token rotation
**Steps:**
1. `cy.request('POST', '/api/v1/auth/login', { email, password })` → capture `csrfToken`
2. `cy.request('POST', '/api/v1/auth/refresh', {}, headers: { 'X-CSRF-Token': csrfToken })` → get new `accessToken`
3. Repeat step 2 with the SAME `csrfToken` again (reuse detection)

**Expected:**
- First refresh: 200, new `accessToken` and `csrfToken`
- Second refresh (reuse): 401 (token family invalidated — reuse detected)

---

### API-002 — CSRF enforcement on refresh
**Steps:**
1. Login, get `csrfToken`
2. Call `POST /api/v1/auth/refresh` WITHOUT `X-CSRF-Token` header

**Expected:**
- 403 or 401 response

---

### API-003 — Rate limiting on login endpoint
**Steps:**
1. Send 21 rapid `POST /api/v1/auth/login` requests with wrong credentials

**Expected:**
- First 20 requests return 401 (invalid creds)
- 21st request returns 429 Too Many Requests

---

### API-004 — What-if returns correct fields
**Steps:**
1. Login as Manager, get access token
2. `cy.request('GET', '/api/v1/analytics/what-if?staffId=EMMA_ID&shiftId=MIAMI_SAT_SHIFT_ID', {}, headers: { Authorization: ... })`

**Expected:**
- Response body has: `result.currentWeeklyHours` (32), `result.projectedWeeklyHours` (38), `result.overtimeRisk` ("WARNING"), `result.consecutiveDays` (number), `result.warnings` (array)

---

### API-005 — Skills list accessible to all authenticated users
**Steps:**
1. Login as Staff (CAROL), capture token
2. `cy.request('GET', '/api/v1/skills', { Authorization: Bearer token })`

**Expected:**
- 200 response
- Body: `{ skills: [{ id, name }, ...] }` with at least 4 skills

---

### API-006 — User creation requires Admin role
**Steps:**
1. Login as Manager (MGR_LA), get token
2. `cy.request({ method: 'POST', url: '/api/v1/users', headers: { Authorization }, body: { ... }, failOnStatusCode: false })`

**Expected:**
- 403 Forbidden

---

---

## Test Execution Order Recommendation

Run suites in the following order to minimize data dependency issues:

1. `auth/` — Authentication (no data dependencies)
2. `nav/` — Navigation/layout (read-only)
3. `users/` — User management (creates/modifies users used later)
4. `availability/` — Availability (depends on users)
5. `schedule/` — Schedule calendar (creates shifts for later tests)
6. `shifts/` — Shift detail & assignments (depends on schedule)
7. `constraints/` — Constraint engine (depends on assignments)
8. `swap-requests/` — Swap/drop (depends on assignments)
9. `dashboard/` — Dashboard widgets (depends on populated data)
10. `analytics/` — Analytics (depends on assignments)
11. `audit/` — Audit log (populated by all prior actions)
12. `realtime/` — Real-time (requires concurrent sessions)
13. `on-duty/` — On-duty board (requires in-progress shifts)
14. `api/` — API contract tests (isolated, can run anytime)

---

## Coverage Matrix

| Requirement Area | Test IDs |
|-----------------|----------|
| Authentication & session | AUTH-001 to AUTH-007 |
| Role-based access control | AUTH-006, AUTH-007, USER-006, AVAIL-004, API-006 |
| Shift CRUD | SCHED-004 to SCHED-007, SHIFT-009, SHIFT-010 |
| Constraint engine (all 11 rules) | CON-001 to CON-005, SHIFT-003 to SHIFT-006 |
| Premium shift auto-tagging | SCHED-007, ANA-002 |
| Overtime detection & what-if | SHIFT-005, SHIFT-006, SHIFT-007, ANA-003, API-004 |
| Swap & drop workflow | SWAP-001 to SWAP-008 |
| Fairness analytics | ANA-001 to ANA-004 |
| Audit trail | AUDIT-001 to AUDIT-006 |
| User management | USER-001 to USER-010 |
| Availability management | AVAIL-001 to AVAIL-005 |
| Real-time / Socket.io | RT-001 to RT-005 |
| On-duty board | ONDUTY-001 to ONDUTY-003 |
| Multi-timezone | SCHED-002, CON-004 |
| CSRF + token rotation | API-001, API-002 |
| Rate limiting | API-003 |
