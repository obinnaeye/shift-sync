/**
 * Custom Cypress commands for ShiftSync E2E tests.
 *
 * Login strategy (no cy.session — fresh login per call):
 *  - POST /auth/login → set the HttpOnly refresh-token cookie + receive csrfToken
 *  - Store csrfToken in sessionStorage via onBeforeLoad BEFORE React boots
 *  - AuthBootstrapper reads the token, calls /auth/refresh, hydrates in-memory
 *    access-token state, and redirects to /dashboard
 *
 * Why no cy.session: The app rotates the refresh token on every /auth/refresh.
 * A cy.session snapshot taken after the first setup holds a consumed token.
 * Restoring it in later tests triggers 401 "Refresh token reuse detected" and
 * silently logs the user out.  A fresh login per call (~1-2 s) is reliable.
 */

const SEED_ACCOUNTS = {
  ADMIN: { email: "admin@shiftsync.local", password: "ChangeMe123!" },
  MGR_LA: { email: "alice.manager@shiftsync.local", password: "Manager1234!" },
  MGR_FL: { email: "bob.manager@shiftsync.local", password: "Manager1234!" },
  CAROL: { email: "carol.smith@shiftsync.local", password: "Staff1234!" },
  EMMA: { email: "emma.williams@shiftsync.local", password: "Staff1234!" },
  HENRY: { email: "henry.wilson@shiftsync.local", password: "Staff1234!" },
  FRANK: { email: "frank.brown@shiftsync.local", password: "Staff1234!" },
  GRACE: { email: "grace.davis@shiftsync.local", password: "Staff1234!" },
  DAVID: { email: "david.jones@shiftsync.local", password: "Staff1234!" },
} as const;

export type SeedHandle = keyof typeof SEED_ACCOUNTS;

// ---------------------------------------------------------------------------
// cy.login(email, password)
// ---------------------------------------------------------------------------
Cypress.Commands.add("login", (email: string, password: string) => {
  // Clear stale auth state before each login
  cy.clearCookies();
  cy.clearAllSessionStorage();

  cy.request({
    method: "POST",
    url: `${Cypress.env("apiUrl")}/auth/login`,
    body: { email, password },
  }).then(({ body }) => {
    // Pre-seed sessionStorage before the app loads so AuthBootstrapper finds
    // the csrfToken and calls /auth/refresh immediately on page load.
    cy.visit("/", {
      onBeforeLoad(win) {
        win.sessionStorage.setItem("shiftsync_csrf_token", body.csrfToken);
      },
    });
    // Bootstrap completes and app redirects to /dashboard
    cy.url({ timeout: 12000 }).should("include", "/dashboard");
  });
});

// ---------------------------------------------------------------------------
// cy.loginAs(handle)  — shorthand using seed account credentials
// ---------------------------------------------------------------------------
Cypress.Commands.add("loginAs", (handle: SeedHandle) => {
  const { email, password } = SEED_ACCOUNTS[handle];
  cy.login(email, password);
});

// ---------------------------------------------------------------------------
// cy.getApiToken(email, password) → yields { accessToken, csrfToken }
// For API contract tests that need a bearer token for cy.request calls.
// ---------------------------------------------------------------------------
Cypress.Commands.add(
  "getApiToken",
  (email: string, password: string): Cypress.Chainable<{ accessToken: string; csrfToken: string }> => {
    return cy
      .request({
        method: "POST",
        url: `${Cypress.env("apiUrl")}/auth/login`,
        body: { email, password },
      })
      .then(({ body }) => ({ accessToken: body.accessToken, csrfToken: body.csrfToken }));
  },
);

// ---------------------------------------------------------------------------
// cy.interceptApi(alias, method, urlSuffix)
// ---------------------------------------------------------------------------
Cypress.Commands.add(
  "interceptApi",
  (alias: string, method: string, urlSuffix: string) => {
    cy.intercept(method as Cypress.HttpMethod, `**${urlSuffix}**`).as(alias);
  },
);

// ---------------------------------------------------------------------------
// cy.waitForBootstrap()
// Wait until the SPA has finished auth-bootstrapping (spinner disappears).
// ---------------------------------------------------------------------------
Cypress.Commands.add("waitForBootstrap", () => {
  cy.get("body", { timeout: 12000 }).should("not.be.empty");
  cy.get("header, form", { timeout: 12000 }).should("exist");
});

// ---------------------------------------------------------------------------
// Type augmentation
// ---------------------------------------------------------------------------
declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
      loginAs(handle: SeedHandle): Chainable<void>;
      getApiToken(
        email: string,
        password: string,
      ): Chainable<{ accessToken: string; csrfToken: string }>;
      interceptApi(alias: string, method: string, urlSuffix: string): Chainable<void>;
      waitForBootstrap(): Chainable<void>;
    }
  }
}
