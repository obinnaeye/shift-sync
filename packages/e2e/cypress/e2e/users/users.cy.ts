/**
 * SUITE 7 — User Management
 * Tests: USER-001 through USER-010
 *
 * before() cleans up state mutated by previous test runs because the seed
 * uses createMany({ skipDuplicates: true }) which does NOT remove records
 * added by earlier runs.  We use the Admin API to restore pristine state.
 *
 * Hardcoded seed IDs (from prisma/seed.ts):
 *   David Jones  : st000002-0000-0000-0000-000000000000
 *   Henry Wilson : st000006-0000-0000-0000-000000000000
 *   Bartender    : sk000001-0000-0000-0000-000000000000
 *   Miami Beach  : 33333333-3333-3333-3333-333333333333
 *
 * Note on POST /users/:id/skills and POST /users/:id/certifications:
 *   Both endpoints return 200 (not 201) per the backend implementation.
 *
 * Note on test user cleanup:
 *   There is no DELETE /users/:id endpoint. To avoid email-uniqueness
 *   conflicts across test runs, we rename previously created "Test Staff"
 *   users to "Archived Staff" and use a timestamp-based email each run.
 */

const DAVID_ID = "st000002-0000-0000-0000-000000000000";
const HENRY_ID = "st000006-0000-0000-0000-000000000000";
const BARTENDER_ID = "sk000001-0000-0000-0000-000000000000";
const MIAMI_ID = "33333333-3333-3333-3333-333333333333";
const API = () => Cypress.env("apiUrl") as string;

// Unique email per test run so we never collide with a user created in a previous run.
// (There is no DELETE /users/:id, so we cannot clean up by email.)
const testEmail = `test.staff.${Date.now()}@shiftsync.local`;

describe("USER — User Management", () => {
  before(() => {
    // Reset state that mutation tests rely on (previous runs may have altered it)
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(
      ({ accessToken }) => {
        const headers = { Authorization: `Bearer ${accessToken}` };

        // Remove Bartender from David if present (USER-004 will re-add it)
        cy.request({
          method: "DELETE",
          url: `${API()}/users/${DAVID_ID}/skills/${BARTENDER_ID}`,
          headers,
          failOnStatusCode: false,
        });

        // Remove Miami cert from Henry if present (USER-006 will re-add it)
        cy.request({
          method: "DELETE",
          url: `${API()}/users/${HENRY_ID}/certifications/${MIAMI_ID}`,
          headers,
          failOnStatusCode: false,
        });

        // Deactivate and rename any previously created "Test Staff" users so their
        // presence doesn't interfere with USER-010 finding the newly created one.
        cy.request({
          method: "GET",
          url: `${API()}/users`,
          headers,
          failOnStatusCode: false,
        }).then(({ body }) => {
          const prevTestUsers = (
            body.users as Array<{ id: string; firstName: string; lastName: string }>
          )?.filter((u) => u.firstName === "Test" && u.lastName === "Staff");

          prevTestUsers?.forEach((u) => {
            cy.request({
              method: "PATCH",
              url: `${API()}/users/${u.id}`,
              headers: { ...headers, "Content-Type": "application/json" },
              body: { isActive: false, firstName: "Archived", lastName: "Staff" },
              failOnStatusCode: false,
            });
          });
        });
      },
    );
  });

  beforeEach(() => {
    cy.loginAs("ADMIN");
    cy.visit("/users");
    cy.contains("Loading users…").should("not.exist");
  });

  // -------------------------------------------------------------------------
  // USER-001 — View user list (Admin)
  // -------------------------------------------------------------------------
  it("USER-001: Admin sees all 9 seeded users in the table", () => {
    const expectedNames = [
      "ShiftSync Admin",
      "Alice Nguyen",
      "Bob Torres",
      "Carol Smith",
      "Emma Williams",
      "Henry Wilson",
      "Frank Brown",
      "Grace Davis",
      "David Jones",
    ];

    expectedNames.forEach((name) => {
      cy.contains(name).should("be.visible");
    });

    // Search input exists — the Input renders without an explicit type attr
    cy.get("input[placeholder*='Search']").should("exist");
  });

  // -------------------------------------------------------------------------
  // USER-002 — Search/filter
  // -------------------------------------------------------------------------
  it("USER-002: Searching 'emma' filters to only Emma Williams", () => {
    cy.get("input[placeholder*='Search']").first().clear().type("emma");

    cy.contains("Emma Williams").should("be.visible");
    cy.contains("Carol Smith").should("not.exist");
    cy.contains("Henry Wilson").should("not.exist");
    cy.contains("Frank Brown").should("not.exist");
  });

  // -------------------------------------------------------------------------
  // USER-003 — Expand user row
  // -------------------------------------------------------------------------
  it("USER-003: Expanding Emma Williams row shows skills and cert chips", () => {
    cy.contains("Emma Williams").click();

    cy.contains(/server/i).should("be.visible");
    cy.contains(/host/i).should("be.visible");

    cy.contains(/venice beach/i).should("be.visible");
    cy.contains(/santa monica/i).should("be.visible");
    cy.contains(/miami/i).should("be.visible");
    cy.contains(/south beach/i).should("be.visible");

    cy.contains("button", "Deactivate").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // USER-004 — Add skill (chip text: "+ SkillName" when not assigned)
  // -------------------------------------------------------------------------
  it("USER-004: Admin adds Bartender skill to David Jones", () => {
    cy.intercept("POST", "**/users/*/skills").as("addSkill");

    cy.contains("David Jones").click();

    // David has only Line Cook — Bartender shows as "+ Bartender"
    cy.contains("+ Bartender").click();

    // The backend POST /users/:id/skills returns 200 (not 201)
    cy.wait("@addSkill").its("response.statusCode").should("be.oneOf", [200, 201]);

    // Chip flips to "✓ Bartender"
    cy.contains("✓ Bartender").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // USER-005 — Remove skill (chip text: "✓ SkillName" when assigned)
  // -------------------------------------------------------------------------
  it("USER-005: Admin removes Bartender skill from David Jones", () => {
    cy.intercept("DELETE", "**/users/*/skills/**").as("removeSkill");

    cy.contains("David Jones").click();

    // Bartender is assigned — click "✓ Bartender" to remove
    cy.contains("✓ Bartender").click();

    cy.wait("@removeSkill").its("response.statusCode").should("be.oneOf", [200, 204]);

    // Chip reverts to "+ Bartender"
    cy.contains("+ Bartender").should("exist");
  });

  // -------------------------------------------------------------------------
  // USER-006 — Grant location certification
  // -------------------------------------------------------------------------
  it("USER-006: Admin certifies Henry Wilson for Miami Beach", () => {
    cy.intercept("POST", "**/users/*/certifications").as("addCert");

    cy.contains("Henry Wilson").click();

    // Henry is not certified for Miami Beach — shows "+ Coastal Eats - Miami Beach"
    cy.contains("+ Coastal Eats - Miami Beach").click();

    // The backend POST /users/:id/certifications returns 200 (not 201)
    cy.wait("@addCert").its("response.statusCode").should("be.oneOf", [200, 201]);

    cy.contains("✓ Coastal Eats - Miami Beach").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // USER-007 — Revoke location certification
  // -------------------------------------------------------------------------
  it("USER-007: Admin revokes Henry Wilson's Miami Beach certification", () => {
    cy.intercept("DELETE", "**/users/*/certifications/**").as("revokeCert");

    cy.contains("Henry Wilson").click();

    cy.contains("✓ Coastal Eats - Miami Beach").click();

    cy.wait("@revokeCert").its("response.statusCode").should("be.oneOf", [200, 204]);

    cy.contains("+ Coastal Eats - Miami Beach").should("exist");
  });

  // -------------------------------------------------------------------------
  // USER-008 — Create new user
  // -------------------------------------------------------------------------
  it("USER-008: Admin creates a new staff user", () => {
    cy.intercept("POST", "**/users").as("createUser");

    cy.contains("button", "Add User").click();

    cy.contains("h2", "Create User").should("be.visible");

    cy.contains("First name").parent().find("input").clear().type("Test");
    cy.contains("Last name").parent().find("input").clear().type("Staff");
    // Use a unique email per run (no DELETE /users/:id endpoint to clean up)
    cy.contains("Email").parent().find("input[type='email']").clear().type(testEmail);
    cy.contains("Password").parent().find("input[type='password']").clear().type("TestPass123!");
    cy.contains("Desired hrs/week").parent().find("input[type='number']").clear().type("32");

    cy.contains("button", "Create User").click();

    cy.wait("@createUser").its("response.statusCode").should("eq", 201);

    cy.contains("Test Staff").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // USER-009 — Duplicate email rejected
  // -------------------------------------------------------------------------
  it("USER-009: Creating a user with an existing email shows an error", () => {
    cy.intercept("POST", "**/users").as("dupCreate");

    cy.contains("button", "Add User").click();
    cy.contains("h2", "Create User").should("be.visible");

    cy.contains("First name").parent().find("input").clear().type("Dup");
    cy.contains("Last name").parent().find("input").clear().type("User");
    cy.contains("Email").parent().find("input[type='email']").clear().type("carol.smith@shiftsync.local");
    cy.contains("Password").parent().find("input[type='password']").clear().type("TestPass123!");

    cy.contains("button", "Create User").click();

    cy.wait("@dupCreate").its("response.statusCode").should("eq", 409);

    // Error shown inline in the modal — use a specific pattern that won't
    // accidentally match the "Users" nav link hidden behind the modal overlay.
    cy.contains(/already in use|email already|email.*conflict/i).should("be.visible");
    // Modal is still open
    cy.contains("h2", "Create User").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // USER-010 — Deactivate user
  // -------------------------------------------------------------------------
  it("USER-010: Admin deactivates a staff user and the row shows Inactive", () => {
    cy.intercept("PATCH", "**/users/**").as("patchUser");

    // Expand Test Staff row
    cy.contains("Test Staff").click();
    cy.contains("button", "Deactivate").click();

    cy.wait("@patchUser").its("response.statusCode").should("be.oneOf", [200, 204]);

    // The main row now shows "Inactive" status
    cy.contains("Test Staff")
      .closest("tr")
      .contains(/inactive/i)
      .should("exist");

  // After the mutation completes the expanded section is still open
  // (the Deactivate button used e.stopPropagation so the row didn't collapse).
  // The button label should now read "Reactivate" without another toggle.
  cy.contains("button", "Reactivate").should("be.visible");
  });
});
