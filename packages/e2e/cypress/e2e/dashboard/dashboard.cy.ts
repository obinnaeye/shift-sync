/**
 * SUITE 2 — Dashboard
 * Tests: DASH-001 through DASH-004
 *
 * Covers: stat cards, role-differentiated dashboard layout,
 *         overtime risk widget, notification preferences toggle.
 */

describe("DASH — Dashboard", () => {
  // -------------------------------------------------------------------------
  // DASH-001 — Dashboard stat cards visible (Manager)
  // -------------------------------------------------------------------------
  it("DASH-001: Manager dashboard shows stat cards, overtime widget, and notification prefs", () => {
    cy.loginAs("MGR_LA");
    cy.visit("/dashboard");

    // Welcome banner
    cy.contains("Alice Nguyen").should("be.visible");

    // Three stat cards (text from the seed-data dashboard)
    cy.contains("ShiftSync").should("be.visible");
    cy.contains("4 Locations").should("be.visible");
    cy.contains(/notification/i).should("be.visible");

    // Overtime Risk widget — only visible to managers
    cy.contains(/overtime risk/i).should("be.visible");
    // Location selector inside the widget (select is sibling of the title's grandparent)
    cy.contains(/overtime risk/i)
      .parent()   // inner flex div (icon + title)
      .parent()   // justify-between flex div containing title + select
      .find("select")
      .should("exist");

    // Notification Preferences card
    cy.contains(/notification preferences/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // DASH-002 — Staff dashboard is simpler
  // -------------------------------------------------------------------------
  it("DASH-002: Staff dashboard does not show overtime widget or on-duty board", () => {
    cy.loginAs("CAROL");
    cy.visit("/dashboard");

    cy.contains("Carol Smith").should("be.visible");

    // Notification Preferences card IS visible
    cy.contains(/notification preferences/i).should("be.visible");

    // Overtime Risk widget is NOT visible for staff
    cy.contains(/overtime risk/i).should("not.exist");

    // On-Duty Board is NOT visible for staff
    cy.contains(/on.?duty board/i).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // DASH-003 — Overtime Risk widget — select location
  // -------------------------------------------------------------------------
  it("DASH-003: Overtime Risk widget loads staff data when a location is selected", () => {
    cy.loginAs("MGR_LA");
    cy.visit("/dashboard");

    cy.intercept("GET", "**/analytics/overtime**").as("overtimeRisk");

    // Wait for locations to load and populate the select options
    cy.contains(/overtime risk/i)
      .parent()
      .parent()
      .find("select")
      .as("locationSelect");

    // The locations query populates options; wait for at least 1 real option
    cy.get("@locationSelect")
      .find("option:not([value=''])", { timeout: 10000 })
      .should("have.length.at.least", 1);

    // Now select the first available location
    cy.get("@locationSelect").then(($select) => {
      const val = $select.find("option:not([value=''])").first().val() as string;
      cy.wrap($select).select(val, { force: true });
    });

    cy.wait("@overtimeRisk", { timeout: 10000 });

    // After the API responds the widget shows either staff-at-risk rows or a
    // "no overtime risk" message — either outcome proves the data loaded.
    cy.contains(/overtime risk/i)
      .parent()
      .parent()
      .parent() // CardHeader
      .parent() // Card root
      .find("ul li, p")
      .should("exist");
    // The card description reflects data loaded (not the default "Choose a location" prompt)
    cy.contains(/no overtime risk|at or approaching overtime|all staff within/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // DASH-004 — Notification preferences toggle persists across reload
  // -------------------------------------------------------------------------
  it("DASH-004: Toggling email simulation persists after page reload", () => {
    cy.loginAs("CAROL");
    cy.visit("/dashboard");

    cy.intercept("PUT", "**/users/me/notification-preferences").as("savePrefs");

    // Find the "Email simulation" checkbox and capture its initial state
    cy.contains("Email simulation")
      .closest("label")
      .find("input[type='checkbox']")
      .then(($cb) => {
        const wasChecked = $cb.prop("checked");

        // Toggle
        cy.wrap($cb).click();
        cy.wait("@savePrefs").its("response.statusCode").should("be.oneOf", [200, 204]);

        // Reload
        cy.reload();
        cy.waitForBootstrap();

        // Checkbox state should be the inverse of the original
        cy.contains("Email simulation")
          .closest("label")
          .find("input[type='checkbox']")
          .should(wasChecked ? "not.be.checked" : "be.checked");

        // Restore the original state so the DB is clean for other tests
        cy.intercept("PUT", "**/users/me/notification-preferences").as("restorePrefs");
        cy.contains("Email simulation").closest("label").find("input[type='checkbox']").click();
        cy.wait("@restorePrefs");
      });
  });
});
