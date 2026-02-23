// Import custom commands
import "./commands";

// ---------------------------------------------------------------------------
// Global before/after hooks
// ---------------------------------------------------------------------------

// Suppress uncaught exceptions from the app that are unrelated to the test
// (e.g., socket.io CORS errors in CI when backend isn't fully up).
Cypress.on("uncaught:exception", (err) => {
  // Allow the test to continue if the error is a known non-critical one
  if (
    err.message.includes("ResizeObserver loop") ||
    err.message.includes("Socket connection") ||
    err.message.includes("WebSocket")
  ) {
    return false;
  }
  return true;
});

// Clear session state between specs so each spec file starts fresh
// (cy.session handles per-test caching within a spec)
beforeEach(() => {
  // Intercept the auth/me endpoint so tests can wait on it
  cy.intercept("GET", "**/auth/me").as("authMe");
  cy.intercept("POST", "**/auth/refresh").as("authRefresh");
});
