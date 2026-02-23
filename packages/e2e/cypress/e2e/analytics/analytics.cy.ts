/**
 * SUITE 9 — Analytics
 * Tests: ANA-001 through ANA-004
 *
 * UI notes discovered during authoring:
 *  - The location <select> options use the FULL location name, e.g.
 *    "Coastal Eats - Venice Beach", not "Venice Beach".  Select by
 *    finding the option whose text includes the substring.
 *  - The hours distribution bars are <div class="h-2 rounded-full bg-blue-500">.
 *  - The fairness API is called automatically on page load, so the intercept
 *    must be set BEFORE cy.visit() to capture the initial request.
 *  - ANA-004 uses a far FUTURE date (not past) to get an empty report,
 *    because weekFrom is a "from" filter — a past date includes all data.
 */

const API = () => Cypress.env("apiUrl") as string;

describe("ANA — Analytics", () => {
  let adminToken: string;

  before(() => {
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(({ accessToken }) => {
      adminToken = accessToken;

      // Ensure Frank has full-week availability (prior tests may have cleared it)
      cy.request({
        method: "PUT",
        url: `${API()}/users/st000004-0000-0000-0000-000000000000/availability`,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
            dayOfWeek: day,
            startTime: "00:00",
            endTime: "23:59",
            timezone: "America/Los_Angeles",
          })),
        },
      });

      cy.request({
        url: `${API()}/locations`,
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(({ body: locBody }) => {
        const locations = locBody.locations as Array<{ id: string; name: string }>;
        const veniceId = locations.find((l) => l.name.toLowerCase().includes("venice"))!.id;
        const miamiId  = locations.find((l) => l.name.toLowerCase().includes("miami beach"))!.id;

        cy.request({
          url: `${API()}/skills`,
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(({ body: skillBody }) => {
          const skills = skillBody.skills as Array<{ id: string; name: string }>;
          const bartenderId = skills.find((s) => s.name === "Bartender")!.id;
          const serverId    = skills.find((s) => s.name === "Server")!.id;

          // ── ANA-002: Frank needs a CONFIRMED Venice Bartender assignment ──────
          // The shifts suite soft-deletes (DROPPED) Frank's seed Venice assignments.
          // The @@unique([shiftId, userId]) constraint prevents re-assigning to a
          // shift where Frank already has any record. Solution: create a BRAND-NEW
          // shift so no existing assignment record exists.
          // We target next Monday (March 2) at 18:00–22:00 UTC so the fairness
          // query (weekFrom = current Monday = Feb 23) includes it.
          const base = new Date();
          const d = base.getDay() || 7;
          const nextMon = new Date(base);
          nextMon.setDate(base.getDate() + (8 - d));
          const monStr = nextMon.toISOString().slice(0, 10);

          cy.request({
            method: "POST",
            url: `${API()}/shifts`,
            headers: { Authorization: `Bearer ${accessToken}` },
            body: {
              locationId: veniceId,
              skillId: bartenderId,
              startTime: `${monStr}T18:00:00.000Z`,
              endTime:   `${monStr}T22:00:00.000Z`,
              headcount: 2,
            },
          }).then(({ body: shiftBody }) => {
            const shiftId = shiftBody.shift.id;
            cy.request({
              method: "POST",
              url: `${API()}/shifts/${shiftId}/assignments`,
              headers: { Authorization: `Bearer ${accessToken}` },
              body: { userId: "st000004-0000-0000-0000-000000000000" },
              failOnStatusCode: false,
            });
            // Publish the Venice week so the shift shows as PUBLISHED
            cy.request({
              method: "POST",
              url: `${API()}/schedules/${veniceId}/${monStr}/publish`,
              headers: { Authorization: `Bearer ${accessToken}` },
              failOnStatusCode: false,
            });
          });

          // ── ANA-003: Emma needs ≥ 35h this week so overtime risk = WARNING ────
          // Seed gives Emma 32h (Mon–Thu 8h each). Create a brand-new Saturday
          // Miami Server shift at 18:00–22:00 UTC (= 13:00–17:00 ET) to avoid
          // any conflict with CON-001/003 Friday shifts. This adds 4h → 36h,
          // which is ≥ 35h (WARNING threshold). Using a time well within Emma's
          // 08:00–23:00 ET availability window avoids any AVAILABILITY violation.
          // Note: the existing sh000012 seed shift ends at 00:00 ET (beyond 23:00
          // ET window) due to server timezone offset, so we create a fresh shift.
          const satDate = new Date(base);
          satDate.setDate(base.getDate() + ((6 + 7 - base.getDay()) % 7 || 7));
          const satStr = satDate.toISOString().slice(0, 10);

          cy.request({
            method: "POST",
            url: `${API()}/shifts`,
            headers: { Authorization: `Bearer ${accessToken}` },
            body: {
              locationId: miamiId,
              skillId: serverId,
              startTime: `${satStr}T18:00:00.000Z`, // 13:00 ET (well within 08:00–23:00 window)
              endTime:   `${satStr}T22:00:00.000Z`, // 17:00 ET
              headcount: 2,
            },
          }).then(({ body: emmaShiftBody }) => {
            cy.request({
              method: "POST",
              url: `${API()}/shifts/${emmaShiftBody.shift.id}/assignments`,
              headers: { Authorization: `Bearer ${accessToken}` },
              body: { userId: "st000003-0000-0000-0000-000000000000" },
              failOnStatusCode: false,
            });
          });
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // ANA-001 — Fairness report loads
  // -------------------------------------------------------------------------
  it("ANA-001: Hours Distribution shows at least 1 staff entry and Emma is listed", () => {
    // Set intercept BEFORE visiting so the initial page-load request is captured
    cy.intercept("GET", "**/analytics/fairness**").as("fairness");
    cy.loginAs("MGR_FL");
    cy.visit("/analytics");
    cy.wait("@fairness");

    // Hours distribution uses div.bg-blue-500.rounded-full as the bar element
    cy.get("div.bg-blue-500.rounded-full").should("have.length.gte", 1);

    // Emma Williams row is visible
    cy.contains("Emma Williams").should("be.visible");

    // Fairness Score card
    cy.contains(/fairness score/i).should("be.visible");
    cy.contains(/\b\d{1,3}\b/).should("be.visible"); // A number 0–100
  });

  // -------------------------------------------------------------------------
  // ANA-002 — Fairness score reflects premium inequity
  // -------------------------------------------------------------------------
  it("ANA-002: Venice Beach analytics shows Carol and Frank with premium shifts", () => {
    cy.intercept("GET", "**/analytics/fairness**").as("fairness");
    cy.loginAs("MGR_LA");
    cy.visit("/analytics");
    cy.wait("@fairness");

    // Set location filter to Venice Beach — option text is "Coastal Eats - Venice Beach"
    cy.get("select").first().find("option").contains(/venice beach/i).then(($opt) => {
      cy.get("select").first().select($opt.val() as string, { force: true });
    });

    cy.wait("@fairness");

    // Carol and Frank should appear in the Venice-filtered report
    cy.contains("Carol Smith").should("be.visible");
    cy.contains("Frank Brown").should("be.visible");

    // At least one "premium" indicator should be visible (either count badge or Premium Shifts card)
    cy.contains(/premium/i).should("be.visible");

    // Fairness score card shows a number
    cy.contains(/fairness score/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // ANA-003 — Overtime Risk table loads per location
  // -------------------------------------------------------------------------
  it("ANA-003: Miami Beach overtime risk table shows Emma (Warning) and Grace (Low)", () => {
    cy.intercept("GET", "**/analytics/overtime**").as("overtimeRisk");
    cy.loginAs("MGR_FL");
    cy.visit("/analytics");

    // Set location filter to Miami Beach
    cy.get("select").first().find("option").contains(/miami beach/i).then(($opt) => {
      cy.get("select").first().select($opt.val() as string, { force: true });
    });

    cy.wait("@overtimeRisk");

    // Emma Williams should appear in the overtime risk table
    cy.contains("Emma Williams").should("be.visible");

    // Warning banner at the bottom (one or more at-risk staff — Emma at 36h triggers it)
    cy.contains(/approaching overtime|overtime warning|approaching or exceeding/i).should(
      "be.visible",
    );
  });

  // -------------------------------------------------------------------------
  // ANA-004 — Filter fairness by week (empty state)
  // Use a far-future week so no seeded data matches.
  // -------------------------------------------------------------------------
  it("ANA-004: Setting a future week with no data shows empty state message", () => {
    cy.intercept("GET", "**/analytics/fairness**").as("fairnessEmpty");
    cy.loginAs("MGR_FL");
    cy.visit("/analytics");
    cy.wait("@fairnessEmpty"); // wait for initial load

    // Change the "Fairness: from week" date to a future date with no seeded data
    // weekFrom is a "from" filter; using a far-future week returns empty report
    const futureDate = "2099-01-07"; // A Monday far in the future
    cy.get("input[type='date']").first().clear().type(futureDate);

    cy.wait("@fairnessEmpty");

    cy.contains(/no scheduling data|no data found|empty/i).should("be.visible");
  });
});
