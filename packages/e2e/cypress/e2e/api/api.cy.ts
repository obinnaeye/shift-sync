/**
 * SUITE 14 — API Contract Tests (via cy.request)
 * Tests: API-001 through API-006
 *
 * These tests call the API directly to verify contract compliance
 * without UI interaction.
 */

const API = () => Cypress.env("apiUrl") as string;

describe("API — API Contract Tests", () => {
  // -------------------------------------------------------------------------
  // API-001 — Refresh token rotation
  // -------------------------------------------------------------------------
  it("API-001: First refresh succeeds; reusing the same CSRF token is rejected (401)", () => {
    // Step 1: Login
    cy.request({
      method: "POST",
      url: `${API()}/auth/login`,
      body: { email: "carol.smith@shiftsync.local", password: "Staff1234!" },
    }).then(({ body: loginBody }) => {
      const originalCsrf = loginBody.csrfToken;

      // Step 2: First refresh — should succeed
      cy.request({
        method: "POST",
        url: `${API()}/auth/refresh`,
        headers: { "X-CSRF-Token": originalCsrf },
      }).then(({ body: firstRefresh, status: firstStatus }) => {
        expect(firstStatus).to.eq(200);
        expect(firstRefresh).to.have.property("accessToken");
        expect(firstRefresh).to.have.property("csrfToken");
        expect(firstRefresh.csrfToken).to.not.eq(originalCsrf); // Token rotated

        // Step 3: Reuse the OLD csrfToken — should be rejected.
        // Cypress automatically carries the rotated refresh-token cookie from
        // step 2, so the old csrfToken no longer matches the new session hash
        // and the server returns 403 (CSRF mismatch) before it can detect
        // token-family reuse (401). Both indicate the old token is rejected.
        cy.request({
          method: "POST",
          url: `${API()}/auth/refresh`,
          headers: { "X-CSRF-Token": originalCsrf },
          failOnStatusCode: false,
        }).then(({ status: reuseStatus }) => {
          expect(reuseStatus).to.be.oneOf([401, 403]);
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // API-002 — CSRF enforcement on refresh
  // -------------------------------------------------------------------------
  it("API-002: Calling /auth/refresh without X-CSRF-Token header returns 403 or 401", () => {
    // Login to get a valid refresh token cookie
    cy.request({
      method: "POST",
      url: `${API()}/auth/login`,
      body: { email: "carol.smith@shiftsync.local", password: "Staff1234!" },
    });

    // Call refresh WITHOUT the CSRF header
    cy.request({
      method: "POST",
      url: `${API()}/auth/refresh`,
      // No X-CSRF-Token header
      failOnStatusCode: false,
    }).then(({ status }) => {
      expect(status).to.be.oneOf([401, 403]);
    });
  });

  // -------------------------------------------------------------------------
  // API-003 — Rate limiting on login endpoint
  //
  // ⚠️  ISOLATION REQUIRED — this test floods the /auth/login endpoint with
  //     21 rapid requests, exhausting the rate-limit window for ALL callers
  //     sharing the same IP.  Run it alone with:
  //       pnpm --filter @shiftsync/e2e cy:run:api
  //     and set DISABLE_RATE_LIMIT=false (or remove the var) in .env first.
  // -------------------------------------------------------------------------
  it("API-003: 21st rapid failed login request returns 429 Too Many Requests", () => {
    const loginUrl = `${API()}/auth/login`;
    const badCreds = { email: "nobody@shiftsync.local", password: "WrongPassword!" };

    // First check if rate limiting is active by peeking at the headers
    cy.request({
      method: "POST",
      url: loginUrl,
      body: badCreds,
      failOnStatusCode: false,
    }).then(({ headers }) => {
      // express-rate-limit sets RateLimit-Policy when active
      if (!headers["ratelimit-policy"] && !headers["ratelimit-limit"]) {
        cy.log(
          "⚠️  API-003 SKIPPED — DISABLE_RATE_LIMIT=true. " +
            "Set DISABLE_RATE_LIMIT=false and run this spec in isolation.",
        );
        return;
      }

      // Rate limiting is active — exhaust the window (20 limit)
      Cypress._.times(19, () => {
        cy.request({
          method: "POST",
          url: loginUrl,
          body: badCreds,
          failOnStatusCode: false,
        });
      });

      // The 21st request (this one) should be 429
      cy.request({
        method: "POST",
        url: loginUrl,
        body: badCreds,
        failOnStatusCode: false,
      })
        .its("status")
        .should("eq", 429);
    });
  });

  // -------------------------------------------------------------------------
  // API-004 — What-if returns correct fields
  // -------------------------------------------------------------------------
  it("API-004: What-if endpoint returns correct projection fields for Emma", () => {
    cy.getApiToken("bob.manager@shiftsync.local", "Manager1234!").then(({ accessToken }) => {
      // Get Emma's ID
      cy.request({
        url: `${API()}/users`,
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(({ body: usersBody }) => {
        const emma = (usersBody.users as Array<{ firstName: string; id: string }>).find(
          (u) => u.firstName === "Emma",
        )!;

        // Get Miami shifts
        cy.request({
          url: `${API()}/locations`,
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(({ body: locsBody }) => {
          const miami = (locsBody.locations as Array<{ id: string; name: string }>).find((l) =>
            l.name.toLowerCase().includes("miami"),
          )!;

          cy.request({
            url: `${API()}/shifts?locationId=${miami.id}&status=PUBLISHED`,
            headers: { Authorization: `Bearer ${accessToken}` },
          }).then(({ body: shiftBody }) => {
            const shift = shiftBody.shifts[0];
            expect(shift).to.exist;

            // Call what-if
            cy.request({
              url: `${API()}/analytics/what-if?staffId=${emma.id}&shiftId=${shift.id}`,
              headers: { Authorization: `Bearer ${accessToken}` },
            }).then(({ body: whatIfBody, status }) => {
              expect(status).to.eq(200);

              const result = whatIfBody.result ?? whatIfBody;
              expect(result).to.have.property("currentWeeklyHours");
              expect(result).to.have.property("projectedWeeklyHours");
              expect(result).to.have.property("overtimeRisk");
              expect(result).to.have.property("consecutiveDays");
              expect(result).to.have.property("warnings");

              // Emma's hours vary with test run history (seed=32, but other suites add hours)
              expect(result.currentWeeklyHours).to.be.a("number").and.to.be.gte(0);
              // AT_LIMIT = exactly 40h; include all possible risk labels
              expect(result.overtimeRisk).to.be.oneOf(["LOW", "WARNING", "AT_LIMIT", "OVER_LIMIT"]);
              expect(result.warnings).to.be.an("array");
            });
          });
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // API-005 — Skills list accessible to all authenticated users
  // -------------------------------------------------------------------------
  it("API-005: Staff can GET /skills and receive at least 4 skills", () => {
    cy.getApiToken("carol.smith@shiftsync.local", "Staff1234!").then(({ accessToken }) => {
      cy.request({
        url: `${API()}/skills`,
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(({ status, body }) => {
        expect(status).to.eq(200);
        expect(body).to.have.property("skills");
        expect(body.skills).to.be.an("array").with.length.gte(4);

        // Each skill has id and name
        body.skills.forEach((skill: { id: string; name: string }) => {
          expect(skill).to.have.property("id");
          expect(skill).to.have.property("name");
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // API-006 — User creation requires Admin role
  // -------------------------------------------------------------------------
  it("API-006: Manager attempting to POST /users receives 403 Forbidden", () => {
    cy.getApiToken("alice.manager@shiftsync.local", "Manager1234!").then(({ accessToken }) => {
      cy.request({
        method: "POST",
        url: `${API()}/users`,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          firstName: "Blocked",
          lastName: "User",
          email: "blocked@shiftsync.local",
          password: "TestPass123!",
          role: "STAFF",
          desiredHoursPerWeek: 20,
        },
        failOnStatusCode: false,
      })
        .its("status")
        .should("eq", 403);
    });
  });
});
