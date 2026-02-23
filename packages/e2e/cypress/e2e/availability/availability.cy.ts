/**
 * SUITE 8 — Availability Management
 * Tests: AVAIL-001 through AVAIL-005
 *
 * Covers: view/edit personal availability (staff), disable/enable days,
 *         cross-user access (403), and manager read access.
 */

// Henry Wilson's seed ID (from prisma/seed.ts)
const HENRY_SEED_ID = "st000006-0000-0000-0000-000000000000";

describe("AVAIL — Availability Management", () => {
  // Reset Henry's availability to the pristine seed state (Mon–Fri 09:00–17:00 LA)
  // before each run so that tests like AVAIL-001 always start from known state.
  before(() => {
    cy.getApiToken("henry.wilson@shiftsync.local", "Staff1234!").then(({ accessToken }) => {
      cy.request({
        method: "PUT",
        url: `${Cypress.env("apiUrl")}/users/${HENRY_SEED_ID}/availability`,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          availability: [1, 2, 3, 4, 5].map((day) => ({
            dayOfWeek: day,
            startTime: "09:00",
            endTime: "17:00",
            timezone: "America/Los_Angeles",
          })),
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // AVAIL-001 — View My Availability page (Staff)
  // -------------------------------------------------------------------------
  it("AVAIL-001: Henry sees his Mon–Fri 09:00–17:00 availability", () => {
    cy.loginAs("HENRY");
    cy.visit("/availability");

    // 7 day rows (Mon–Sun)
    cy.get("input[type='checkbox']").should("have.length.gte", 7);

    // Monday–Friday are checked ON with 09:00–17:00
    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
    weekdays.forEach((day) => {
      cy.contains(new RegExp(day, "i"))
        .closest("label")
        .find("input[type='checkbox']")
        .should("be.checked");
    });

    // Saturday and Sunday are unchecked (unavailable)
    ["saturday", "sunday"].forEach((day) => {
      cy.contains(new RegExp(day, "i"))
        .closest("label")
        .find("input[type='checkbox']")
        .should("not.be.checked");
    });

    // Timezone displayed
    cy.contains(/america\/los_angeles|los angeles/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // AVAIL-002 — Enable a previously-off day
  // -------------------------------------------------------------------------
  it("AVAIL-002: Henry enables Saturday with 10:00–16:00 and it persists", () => {
    cy.loginAs("HENRY");
    cy.visit("/availability");

    // The frontend sends PUT /users/{userId}/availability (not /users/me/...)
    cy.intercept("PUT", "**/users/*/availability").as("saveAvail");

    // Enable Saturday — the checkbox is inside a <label> that is a sibling of
    // the time-input container.  Find the row's outer div via .closest("label").parent().
    cy.contains(/saturday/i)
      .closest("label")
      .find("input[type='checkbox']")
      .check({ force: true });

    // Time inputs live in a sibling <div> of the <label>, so scope to the parent row div.
    cy.contains(/saturday/i)
      .closest("label")
      .parent()
      .within(() => {
        cy.get("input[type='time']").first().clear().type("10:00");
        cy.get("input[type='time']").last().clear().type("16:00");
      });

    // Save
    cy.contains("button", /save/i).click();
    cy.wait("@saveAvail").its("response.statusCode").should("be.oneOf", [200, 204]);
    cy.contains(/saved|success/i).should("be.visible");

    // Reload and verify persistence
    cy.reload();
    cy.waitForBootstrap();

    cy.contains(/saturday/i)
      .closest("label")
      .find("input[type='checkbox']")
      .should("be.checked");
  });

  // -------------------------------------------------------------------------
  // AVAIL-003 — Disable a day
  // -------------------------------------------------------------------------
  it("AVAIL-003: Henry unchecks Monday and it persists as unavailable", () => {
    cy.loginAs("HENRY");
    cy.visit("/availability");

    // The frontend sends PUT /users/{userId}/availability (not /users/me/...)
    cy.intercept("PUT", "**/users/*/availability").as("saveAvail");

    cy.contains(/monday/i)
      .closest("label")
      .find("input[type='checkbox']")
      .uncheck({ force: true });

    cy.contains("button", /save/i).click();
    cy.wait("@saveAvail").its("response.statusCode").should("be.oneOf", [200, 204]);

    // Reload and verify
    cy.reload();
    cy.waitForBootstrap();

    cy.contains(/monday/i)
      .closest("label")
      .find("input[type='checkbox']")
      .should("not.be.checked");

    // Restore Monday for subsequent tests
    cy.intercept("PUT", "**/users/*/availability").as("restoreAvail");
    cy.contains(/monday/i)
      .closest("label")
      .find("input[type='checkbox']")
      .check({ force: true });
    cy.contains("button", /save/i).click();
    cy.wait("@restoreAvail");
  });

  // -------------------------------------------------------------------------
  // AVAIL-004 — Staff cannot access another staff member's availability
  // -------------------------------------------------------------------------
  it("AVAIL-004: Carol gets 403 when requesting Henry's availability via API", () => {
    // Get Henry's user ID first (as Admin)
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(({ accessToken }) => {
      cy.request({
        url: `${Cypress.env("apiUrl")}/users`,
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(({ body }) => {
        const henry = (body.users as Array<{ firstName: string; id: string }>).find(
          (u) => u.firstName === "Henry",
        );
        expect(henry).to.exist;

        // Now as Carol, try to access Henry's availability
        cy.getApiToken("carol.smith@shiftsync.local", "Staff1234!").then(
          ({ accessToken: carolToken }) => {
            cy.request({
              url: `${Cypress.env("apiUrl")}/users/${henry!.id}/availability`,
              headers: { Authorization: `Bearer ${carolToken}` },
              failOnStatusCode: false,
            })
              .its("status")
              .should("eq", 403);
          },
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // AVAIL-005 — Manager can view staff availability
  // -------------------------------------------------------------------------
  it("AVAIL-005: Manager gets 200 when requesting Henry's availability via API", () => {
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(({ accessToken: adminToken }) => {
      cy.request({
        url: `${Cypress.env("apiUrl")}/users`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then(({ body }) => {
        const henry = (body.users as Array<{ firstName: string; id: string }>).find(
          (u) => u.firstName === "Henry",
        );
        expect(henry).to.exist;

        cy.getApiToken("alice.manager@shiftsync.local", "Manager1234!").then(
          ({ accessToken: mgrToken }) => {
            cy.request({
              url: `${Cypress.env("apiUrl")}/users/${henry!.id}/availability`,
              headers: { Authorization: `Bearer ${mgrToken}` },
              failOnStatusCode: false,
            })
              .its("status")
              .should("eq", 200);
          },
        );
      });
    });
  });
});
