const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    fixturesFolder: "cypress/fixtures",
    videosFolder: "cypress/videos",
    screenshotsFolder: "cypress/screenshots",
    viewportWidth: 1280,
    viewportHeight: 800,
    defaultCommandTimeout: 8000,
    requestTimeout: 10000,
    responseTimeout: 10000,
    video: true,
    testIsolation: true,

    // ---------------------------------------------------------------------------
    // setupNodeEvents — kept minimal (no shell-spawn logic here because
    // Cypress's plugin subprocess runs in a sandboxed environment on Linux/WSL2
    // that cannot spawn external processes reliably).  The DB reset is done as
    // a pre-step in the npm script (see root package.json → test:e2e).
    // ---------------------------------------------------------------------------
    setupNodeEvents(on, config) {
      return config;
    },
  },

  env: {
    apiUrl: "http://localhost:4000/api/v1",
  },
});
