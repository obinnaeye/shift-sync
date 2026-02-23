/**
 * SUITE 13 — Navigation & Layout
 * Tests: NAV-001 through NAV-003
 *
 * Covers: active nav highlighting, 404 page, and mobile viewport layout.
 */

describe("NAV — Navigation & Layout", () => {
  // -------------------------------------------------------------------------
  // NAV-001 — Active nav item highlighted
  // -------------------------------------------------------------------------
  it("NAV-001: Active nav item is visually highlighted", () => {
    cy.loginAs("MGR_LA");
    cy.visit("/schedule");

    // The Schedule nav link should carry the active class (bg-slate-700 text-white)
    // We check aria-current or the active class applied by NavLink
    cy.contains("a", /schedule/i).should(($a) => {
      const cls = $a.attr("class") ?? "";
      // react-router NavLink adds the active class when the route matches
      expect(cls).to.match(/bg-slate-700|text-white/);
    });

    // Dashboard nav link should NOT be highlighted while on /schedule
    cy.contains("a", /dashboard/i).should(($a) => {
      const cls = $a.attr("class") ?? "";
      expect(cls).not.to.match(/bg-slate-700/);
    });
  });

  // -------------------------------------------------------------------------
  // NAV-002 — 404 page for unknown routes
  // -------------------------------------------------------------------------
  it("NAV-002: Unknown route shows NotFound page with dashboard link", () => {
    cy.loginAs("CAROL");
    cy.visit("/this-route-does-not-exist", { failOnStatusCode: false });

    // NotFoundPage renders a recognisable message
    cy.contains(/not found|404|page.*exist/i).should("be.visible");

    // "Go to Dashboard" button exists and navigates
    cy.contains(/go to dashboard|dashboard/i)
      .should("be.visible")
      .click();

    cy.url().should("include", "/dashboard");
  });

  // -------------------------------------------------------------------------
  // NAV-003 — Mobile layout (375px viewport)
  // -------------------------------------------------------------------------
  it("NAV-003: Mobile layout does not overflow and remains usable", () => {
    cy.viewport(375, 667);
    cy.loginAs("CAROL");
    cy.visit("/dashboard");

    // No horizontal overflow
    cy.get("body").then(($body) => {
      expect($body[0].scrollWidth).to.be.lte($body[0].clientWidth + 5); // allow 5px tolerance
    });

    // The topbar still renders
    cy.get("header").should("be.visible");

    // Content area stacks vertically — just check the main element is visible
    cy.get("main").should("be.visible");
  });
});
