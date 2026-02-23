/**
 * SUITE 3 — Schedule Calendar
 * Tests: SCHED-001 through SCHED-007
 *
 * Covers: calendar rendering, timezone display, week navigation,
 *         create shift modal, validation, role guard, premium auto-tag.
 *
 * Helper: resolveLocationId() fetches locations from the API and returns
 *         the ID matching a given name substring.
 */

function resolveLocationId(token: string, nameSubstring: string): Cypress.Chainable<string> {
  return cy
    .request({
      url: `${Cypress.env("apiUrl")}/locations`,
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(({ body }) => {
      const loc = (body.locations as Array<{ id: string; name: string }>).find((l) =>
        l.name.toLowerCase().includes(nameSubstring.toLowerCase()),
      );
      expect(loc, `Location containing "${nameSubstring}" should exist`).to.exist;
      return loc!.id;
    });
}

describe("SCHED — Schedule Calendar", () => {
  let mgrToken: string;
  let veniceId: string;
  let miamiId: string;

  before(() => {
    // Use admin token for location resolution — Alice (LA manager) only sees
    // her two locations, so /locations would never return Miami Beach.
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(({ accessToken: adminToken }) => {
      resolveLocationId(adminToken, "venice").then((id) => {
        veniceId = id;
      });
      resolveLocationId(adminToken, "miami").then((id) => {
        miamiId = id;
      });
    });

    cy.getApiToken("alice.manager@shiftsync.local", "Manager1234!").then((t) => {
      mgrToken = t.accessToken;
    });
  });

  // -------------------------------------------------------------------------
  // SCHED-001 — Calendar renders for a location
  // -------------------------------------------------------------------------
  it("SCHED-001: FullCalendar renders shifts for Venice Beach", () => {
    cy.loginAs("MGR_LA");
    cy.intercept("GET", "**/shifts**").as("getShifts");
    cy.visit(`/schedule?locationId=${veniceId}`);

    cy.wait("@getShifts");

    // FullCalendar renders — look for the fc-view or time-grid elements
    cy.get(".fc, [data-cy='calendar']").should("exist");

    // Seeded shifts appear as calendar events
    cy.get(".fc-event, [class*='fc-event']").should("have.length.gte", 1);

    // Week range title is visible
    cy.get(".fc-toolbar-title, [class*='fc-toolbar']").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SCHED-002 — Calendar respects timezone (Miami Beach → ET)
  // -------------------------------------------------------------------------
  it("SCHED-002: Miami Beach shifts display times in America/New_York", () => {
    // Must use MGR_FL — Alice (MGR_LA) does not manage Miami and the API
    // returns 403 when she requests shifts for that location.
    cy.loginAs("MGR_FL");
    cy.intercept("GET", "**/shifts**").as("getShifts");
    cy.visit(`/schedule?locationId=${miamiId}`);

    cy.wait("@getShifts");

    // FullCalendar renders (has events seeded for Miami Beach this week)
    cy.get(".fc, [data-cy='calendar']").should("exist");

    // Schedule page shows "Displaying times in America/New_York" for ET locations
    cy.contains(/america\/new_york/i, { timeout: 10000 }).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SCHED-003 — Week navigation
  // -------------------------------------------------------------------------
  it("SCHED-003: Changing the week input advances the calendar and updates the URL", () => {
    cy.loginAs("MGR_LA");
    cy.intercept("GET", "**/shifts**").as("getShifts");
    cy.visit(`/schedule?locationId=${veniceId}`);

    // Get next Monday's date
    const nextMonday = new Date();
    nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));
    const nextMondayStr = nextMonday.toISOString().split("T")[0];

    // Change the week date input
    cy.get("input[type='date'], input[type='week']").first().clear().type(nextMondayStr);

    cy.wait("@getShifts");

    // URL should include the week parameter
    cy.url().should("include", "week=");

    // Calendar title should show the next week range
    cy.get(".fc-toolbar-title, [class*='fc-toolbar']").should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SCHED-004 — Create Shift modal (Manager)
  // -------------------------------------------------------------------------
  it("SCHED-004: Manager creates a new DRAFT shift via the modal", () => {
    cy.loginAs("MGR_LA");
    cy.visit(`/schedule?locationId=${veniceId}`);

    cy.intercept("POST", "**/shifts").as("createShift");

    // Wait for the page-level location select to populate, ensuring
    // locationsQuery.data is ready before we open the modal (the modal
    // initialises its own locationId state from the locations prop).
    cy.get("select").find("option:not([disabled])").should("have.length.gte", 1);

    // Open create shift modal
    cy.contains("button", /\+ create shift|create shift/i).click();

    // Modal is visible — scope ALL modal interactions inside the overlay
    cy.get(".fixed.inset-0").within(() => {
      cy.contains(/create new shift/i).should("be.visible");

      // Wait for location options to populate, then select first (Venice Beach)
      cy.get("select").first().find("option").should("have.length.gte", 1);
      cy.get("select").first().find("option").first().then(($opt) => {
        cy.get("select").first().select($opt.val() as string, { force: true });
      });

      // Select skill
      cy.get("select").last().select("Server", { force: true });

      // Set times for next Tuesday
      const nextTuesday = new Date();
      nextTuesday.setDate(nextTuesday.getDate() + ((2 + 7 - nextTuesday.getDay()) % 7 || 7));
      const dateStr = nextTuesday.toISOString().slice(0, 10);

      cy.get("input[type='datetime-local']").first().type(`${dateStr}T10:00`);
      cy.get("input[type='datetime-local']").last().type(`${dateStr}T16:00`);

      // Set headcount to 2
      cy.get("input[type='number']").clear().type("2");

      cy.contains("button", /create shift|save/i).click({ force: true });
    });

    cy.wait("@createShift").then((interception) => {
      expect(interception.response!.statusCode).to.eq(201);
      expect(interception.response!.body.shift.status).to.eq("DRAFT");
    });

    // Modal closes
    cy.contains(/create new shift/i).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // SCHED-005 — Create Shift validation — end before start
  // -------------------------------------------------------------------------
  it("SCHED-005: Shift creation fails when end time is before start time", () => {
    cy.loginAs("MGR_LA");
    cy.visit(`/schedule?locationId=${veniceId}`);

    cy.intercept("POST", "**/shifts").as("badShift");

    // Wait for locations to be loaded before opening the modal
    cy.get("select").find("option:not([disabled])").should("have.length.gte", 1);
    cy.contains("button", /\+ create shift|create shift/i).click();

    // Scope ALL modal interactions inside the overlay container
    cy.get(".fixed.inset-0").within(() => {
      cy.contains(/create new shift/i).should("be.visible");
      cy.get("select").first().find("option").should("have.length.gte", 1);

      // Select first location, first skill
      cy.get("select").first().find("option").first().then(($opt) => {
        cy.get("select").first().select($opt.val() as string, { force: true });
      });
      cy.get("select").last().find("option:not([disabled])").first().then(($opt) => {
        cy.get("select").last().select($opt.val() as string, { force: true });
      });

      const nextTuesday = new Date();
      nextTuesday.setDate(nextTuesday.getDate() + ((2 + 7 - nextTuesday.getDay()) % 7 || 7));
      const dateStr = nextTuesday.toISOString().slice(0, 10);

      // Start at 5pm, end at 8am (invalid)
      cy.get("input[type='datetime-local']").first().type(`${dateStr}T17:00`);
      cy.get("input[type='datetime-local']").last().type(`${dateStr}T08:00`);

      cy.contains("button", /create shift|save/i).click({ force: true });
    });

    cy.wait("@badShift").its("response.statusCode").should("be.oneOf", [400, 422]);

    // Error shown inside modal
    cy.get(".fixed.inset-0").within(() => {
      cy.contains(/start.*before.*end|end.*before.*start|invalid time/i).should("be.visible");
      cy.contains(/create new shift/i).should("be.visible");
    });
  });

  // -------------------------------------------------------------------------
  // SCHED-006 — Create Shift blocked for Staff
  // -------------------------------------------------------------------------
  it("SCHED-006: Staff user does not see the Create Shift button", () => {
    cy.loginAs("CAROL");
    cy.visit("/schedule");

    // The "+ Create Shift" button must not be visible for staff
    cy.contains("button", /\+ create shift|create shift/i).should("not.exist");
  });

  // -------------------------------------------------------------------------
  // SCED-007 — Premium shift auto-tagged
  // -------------------------------------------------------------------------
  // Shift is created via API with explicit UTC timestamps to bypass the
  // server-local-timezone ambiguity that datetime-local inputs introduce.
  // Friday 17:00–23:00 LA (UTC-8) = Saturday 01:00–07:00 UTC → isPremium=true.
  it("SCHED-007: A Friday evening Bartender shift is auto-tagged as premium", () => {
    // Compute next Friday's UTC date
    const friday = new Date();
    friday.setDate(friday.getDate() + ((5 + 7 - friday.getDay()) % 7 || 7));
    // Saturday 01:00 UTC = Friday 17:00 PST (UTC-8)
    const satStr = new Date(friday.getTime() + 86400000).toISOString().slice(0, 10);
    const startUTC = `${satStr}T01:00:00.000Z`; // Friday 17:00 LA
    const endUTC   = `${satStr}T07:00:00.000Z`; // Friday 23:00 LA

    cy.request({
      url: `${Cypress.env("apiUrl")}/skills`,
      headers: { Authorization: `Bearer ${mgrToken}` },
    }).then(({ body: skillBody }) => {
      const bartenderId = (skillBody.skills as Array<{ id: string; name: string }>).find(
        (s) => s.name === "Bartender",
      )!.id;

      cy.request({
        method: "POST",
        url: `${Cypress.env("apiUrl")}/shifts`,
        headers: { Authorization: `Bearer ${mgrToken}` },
        body: { locationId: veniceId, skillId: bartenderId, startTime: startUTC, endTime: endUTC, headcount: 2 },
      }).then(({ body, status }) => {
        expect(status).to.eq(201);
        expect(body.shift.isPremium).to.eq(true);

        // Navigate to the shift detail page and verify the Premium badge in the UI
        cy.loginAs("MGR_LA");
        cy.visit(`/shifts/${body.shift.id}`);
        cy.contains(/premium/i).should("be.visible");
      });
    });
  });
});
