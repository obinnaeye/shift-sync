/**
 * SUITE 1 — Authentication
 * Tests: AUTH-001 through AUTH-007
 *
 * Covers: login (staff/manager), invalid credentials, session persistence,
 *         logout, protected route redirect, and role-based route guards.
 */

describe("AUTH — Authentication", () => {
  // -------------------------------------------------------------------------
  // AUTH-001 — Successful login (Staff)
  // -------------------------------------------------------------------------
  it("AUTH-001: Staff logs in and sees staff navigation", () => {
    cy.visit("/login");
    cy.contains("ShiftSync", { timeout: 15000 }).should("be.visible");

    cy.get("#email").clear().type("carol.smith@shiftsync.local");
    cy.get("#password").clear().type("Staff1234!");
    cy.contains("button", /sign in/i).click();

    cy.url({ timeout: 10000 }).should("include", "/dashboard");

    // User name visible in topbar
    cy.contains("Carol Smith").should("be.visible");

    // Role badge shows STAFF
    cy.contains(/^staff$/i).should("be.visible");

    // Staff-specific nav items are present
    cy.contains("a", /dashboard/i).should("be.visible");
    cy.contains("a", /schedule/i).should("be.visible");
    cy.contains("a", /swap/i).should("be.visible");
    cy.contains("a", /availability/i).should("be.visible");

    // Manager-only nav items are NOT present
    cy.contains("a", /users/i).should("not.exist");
    cy.contains("a", /analytics/i).should("not.exist");
    cy.contains("a", /audit/i).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // AUTH-002 — Successful login (Manager)
  // -------------------------------------------------------------------------
  it("AUTH-002: Manager logs in and sees manager navigation", () => {
    cy.visit("/login");
    cy.get("#email").clear().type("alice.manager@shiftsync.local");
    cy.get("#password").clear().type("Manager1234!");
    cy.contains("button", /sign in/i).click();

    cy.url({ timeout: 10000 }).should("include", "/dashboard");

    cy.contains("Alice Nguyen").should("be.visible");
    cy.contains(/^manager$/i).should("be.visible");

    // Manager nav items
    cy.contains("a", /dashboard/i).should("be.visible");
    cy.contains("a", /schedule/i).should("be.visible");
    cy.contains("a", /swap/i).should("be.visible");
    cy.contains("a", /users/i).should("be.visible");
    cy.contains("a", /analytics/i).should("be.visible");
    cy.contains("a", /audit/i).should("be.visible");

    // Availability is staff-only — managers do not have this link
    cy.contains("a", /availability/i).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // AUTH-003 — Invalid credentials
  // -------------------------------------------------------------------------
  it("AUTH-003: Wrong password shows error and stays on /login", () => {
    cy.visit("/login");
    cy.get("#email").clear().type("carol.smith@shiftsync.local");
    cy.get("#password").clear().type("WrongPassword!");
    cy.contains("button", /sign in/i).click();

    // Remains on login
    cy.url().should("include", "/login");

    // Error message visible
    cy.contains(/invalid|credentials|password/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // AUTH-004 — Session persistence on page refresh
  // -------------------------------------------------------------------------
  it("AUTH-004: Session persists after page reload", () => {
    cy.loginAs("CAROL");
    cy.visit("/dashboard");
    cy.contains("Carol Smith").should("be.visible");

    cy.reload();
    cy.waitForBootstrap();

    // Should NOT be redirected to /login
    cy.url({ timeout: 10000 }).should("not.include", "/login");
    cy.contains("Carol Smith").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // AUTH-005 — Logout
  // -------------------------------------------------------------------------
  it("AUTH-005: Logout clears session and redirects to /login", () => {
    // cy.loginAs already lands us on /dashboard and waits for it
    cy.loginAs("CAROL");
    // After loginAs, we are already on /dashboard with the user loaded
    cy.contains("Carol Smith", { timeout: 10000 }).should("be.visible");

    // Click the logout button (aria-label="Logout")
    cy.get('[aria-label="Logout"]').click();

    cy.url({ timeout: 8000 }).should("include", "/login");

    // Revisiting dashboard redirects back to login (session cleared)
    cy.visit("/dashboard");
    cy.url({ timeout: 8000 }).should("include", "/login");
  });

  // -------------------------------------------------------------------------
  // AUTH-006 — Protected route redirect (unauthenticated)
  // -------------------------------------------------------------------------
  it("AUTH-006: Unauthenticated visit to /dashboard redirects to /login", () => {
    // Clear all session state
    cy.clearCookies();
    cy.clearLocalStorage();
    cy.clearAllSessionStorage();

    cy.visit("/dashboard");
    cy.url({ timeout: 8000 }).should("include", "/login");
  });

  // -------------------------------------------------------------------------
  // AUTH-007 — Role guard: Staff cannot access Manager routes
  // -------------------------------------------------------------------------
  it("AUTH-007: Staff navigating to manager-only routes is blocked", () => {
    // ManagerRoute guard redirects non-managers to /schedule (per guards.tsx:28)
    cy.loginAs("CAROL");

    // /users
    cy.visit("/users");
    // Wait until the React redirect fires (away from /users)
    cy.url({ timeout: 10000 }).should("not.include", "/users");
    cy.url().should("match", /\/(schedule|dashboard|login)/);

    // /analytics — re-login to get fresh tokens after previous redirect
    cy.loginAs("CAROL");
    cy.visit("/analytics");
    cy.url({ timeout: 10000 }).should("not.include", "/analytics");
    cy.url().should("match", /\/(schedule|dashboard|login)/);

    // /audit
    cy.loginAs("CAROL");
    cy.visit("/audit");
    cy.url({ timeout: 10000 }).should("not.include", "/audit");
    cy.url().should("match", /\/(schedule|dashboard|login)/);
  });
});
