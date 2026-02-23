/**
 * SUITE 10 — Audit Log
 * Tests: AUDIT-001 through AUDIT-006
 *
 * UI notes discovered by inspecting audit-page.tsx:
 *  - The Location <select> is the FIRST <select> on the page (no name attribute).
 *    Option text = full location name, e.g. "Coastal Eats - Venice Beach".
 *  - The Entity type <select> is the SECOND <select>. Values are "Shift",
 *    "ShiftAssignment", "SwapRequest" (display text differs: "Assignment").
 *  - Timestamp column format: "Feb 23, 2026 14:30:00 UTC" (via date-fns-tz).
 *  - Total events shown as "{total} total events" in the card description.
 *  - Pagination only renders when total > 50.
 *  - Row expansion shows before/after JSON in <pre> blocks.
 */

const API = () => Cypress.env("apiUrl") as string;

describe("AUDIT — Audit Log", () => {
  // ---------------------------------------------------------------------------
  // Ensure there are always >50 audit events so AUDIT-006 can exercise
  // pagination.  On a fresh test DB the seed creates 0 audit log entries
  // (data is inserted directly into the DB without going through the API).
  // We bulk-create DRAFT Venice shifts via the API to pad the log.
  // ---------------------------------------------------------------------------
  before(() => {
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(({ accessToken }) => {
      cy.request({
        url: `${API()}/audit-logs?limit=1`,
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(({ body }) => {
        const currentTotal = (body.total as number) ?? 0;
        const needed = Math.max(0, 55 - currentTotal); // target 55 so total > 50

        if (needed === 0) return;

        cy.request({
          url: `${API()}/locations`,
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(({ body: locBody }) => {
          const veniceId = (locBody.locations as Array<{ id: string; name: string }>).find(
            (l) => l.name.toLowerCase().includes("venice"),
          )!.id;

          cy.request({
            url: `${API()}/skills`,
            headers: { Authorization: `Bearer ${accessToken}` },
          }).then(({ body: skillBody }) => {
            const hostSkillId = (skillBody.skills as Array<{ id: string; name: string }>).find(
              (s) => s.name === "Host",
            )!.id;

            // Spread shifts across future weeks to avoid any schedule conflicts
            const base = new Date("2027-01-04T10:00:00.000Z");
            Cypress._.times(needed, (i) => {
              const startIso = new Date(base.getTime() + i * 3600000).toISOString();
              const endIso   = new Date(base.getTime() + i * 3600000 + 3600000).toISOString();
              cy.request({
                method: "POST",
                url: `${API()}/shifts`,
                headers: { Authorization: `Bearer ${accessToken}` },
                body: { locationId: veniceId, skillId: hostSkillId, startTime: startIso, endTime: endIso, headcount: 1 },
                failOnStatusCode: false,
              });
            });
          });
        });
      });
    });
  });

  beforeEach(() => {
    cy.loginAs("ADMIN");
    cy.intercept("GET", "**/audit-logs**").as("getAudit");
    cy.visit("/audit");
    cy.wait("@getAudit");
  });

  // -------------------------------------------------------------------------
  // AUDIT-001 — Audit log loads with events
  // -------------------------------------------------------------------------
  it("AUDIT-001: Admin sees audit events from seed data", () => {
    // At least one audit row exists (seed + prior test runs create events)
    cy.get("table tbody tr").should("have.length.gte", 1);

    // Each row has a timestamp in "MMM d, yyyy HH:mm:ss UTC" format
    cy.get("table tbody tr").first().within(() => {
      // The second <td> holds the timestamp — just verify it contains a year
      cy.get("td").eq(1).invoke("text").should("match", /\d{4}/);
    });

    // Action badges are present
    cy.contains(/create|publish|assign|unassign/i).should("be.visible");

    // Total event count shown in card description
    cy.contains(/total events/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // AUDIT-002 — Filter by location
  // -------------------------------------------------------------------------
  it("AUDIT-002: Filtering by Venice Beach shows only Venice events", () => {
    cy.intercept("GET", "**/audit-logs**").as("filteredAudit");

    // Location is the FIRST <select>; option text is the full location name
    cy.get("select").first().find("option").contains(/venice/i).then(($opt) => {
      cy.get("select").first().select($opt.val() as string, { force: true });
    });

    cy.wait("@filteredAudit");

    // Venice events should appear in the table Shift/ID column
    cy.get("table").contains(/venice/i).should("be.visible");

    // Miami events should NOT appear within the audit table rows
    // (the location select dropdown still shows all options, so we scope to table)
    cy.get("table tbody").contains(/miami/i).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // AUDIT-003 — Filter by entity type
  // -------------------------------------------------------------------------
  it("AUDIT-003: Filtering by ShiftAssignment shows only assignment events", () => {
    cy.intercept("GET", "**/audit-logs**").as("entityFiltered");

    // Entity type is the SECOND <select>; select by value "ShiftAssignment"
    cy.get("select").eq(1).select("ShiftAssignment", { force: true });

    cy.wait("@entityFiltered");

    // Assignment-related action badges (ASSIGN, UNASSIGN, CREATE, UPDATE) should be visible.
    // Assignments use action="CREATE" when first inserted and action="ASSIGN"/"UNASSIGN"
    // for subsequent transitions, so we just verify the entity column shows ShiftAssignment.
    cy.contains(/assign/i).should("be.visible");

    // Every row's Entity column should show "ShiftAssignment" (not "Shift" or "SwapRequest")
    cy.get("table tbody tr").each(($row) => {
      cy.wrap($row).find("td").eq(4).invoke("text").should("eq", "ShiftAssignment");
    });
  });

  // -------------------------------------------------------------------------
  // AUDIT-004 — Filter by date range
  // -------------------------------------------------------------------------
  it("AUDIT-004: Setting a date range to yesterday–today filters old events", () => {
    cy.intercept("GET", "**/audit-logs**").as("dateFiltered");

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    cy.get("input[type='date']").first().clear().type(yesterday);
    cy.get("input[type='date']").last().clear().type(today);

    cy.wait("@dateFiltered");

    // Events from 2020 should NOT appear
    cy.contains(/2020/i).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // AUDIT-005 — Expand a log row to see before/after JSON
  // -------------------------------------------------------------------------
  it("AUDIT-005: Clicking an ASSIGN event row shows after-state JSON", () => {
    cy.intercept("GET", "**/audit-logs**").as("assignAudit");

    // Filter to ShiftAssignment events (second select, value = "ShiftAssignment")
    cy.get("select").eq(1).select("ShiftAssignment", { force: true });
    cy.wait("@assignAudit");

    // Click the first row to expand it
    cy.get("table tbody tr").first().click();

    // After-state JSON panel should be visible
    cy.contains(/"userId"|"shiftId"|"status"/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // AUDIT-006 — Pagination
  // -------------------------------------------------------------------------
  it("AUDIT-006: Pagination shows Page 1 and Next navigates to Page 2", () => {
    // Pagination renders only when total > 50 (guaranteed by the before() hook above).
    cy.contains(/page 1/i).should("be.visible");

    cy.intercept("GET", "**/audit-logs**").as("page2");
    cy.contains("button", /next/i).click();
    cy.wait("@page2");

    cy.contains(/page 2/i).should("be.visible");
    cy.contains("button", /prev/i).should("not.be.disabled");
  });
});
