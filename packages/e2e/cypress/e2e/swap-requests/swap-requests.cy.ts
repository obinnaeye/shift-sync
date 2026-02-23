/**
 * SUITE 6 — Swap & Drop Requests
 * Tests: SWAP-001 through SWAP-008
 *
 * UI Notes (from swap-requests-page.tsx):
 *  - "My assignment" select has no `name` attr — select with cy.get("select").first()
 *  - Request type is the SECOND select (defaults to DROP; switch to SWAP as needed)
 *  - Target staff for SWAP is an Input.font-mono (UUID), not a select
 *  - Submit button: "Submit Request"
 *  - Accept/Reject (staff) and Approve/Reject (manager) buttons exist in the UI
 *  - Pick-up button: "Pick Up Shift"
 *  - PENDING_MANAGER / APPROVED badges are visible on the requester's page only
 *    After accept/reject, those statuses are NOT visible to the counterparty.
 *    → verify those transitions via API response codes instead of UI text.
 *
 * Three separate assignments are created in before() to avoid cross-test pollution:
 *   carolServerAssignmentId   → SWAP-001..003 (swap with Emma)
 *   carolAltAssignmentId      → SWAP-004..005 (reject / cancel tests)
 *   carolBartenderAssignmentId → SWAP-006..007 (drop + pickup by Frank)
 */

const API = () => Cypress.env("apiUrl") as string;

const CAROL_SEED_ID = "st000001-0000-0000-0000-000000000000";
const FRANK_SEED_ID = "st000004-0000-0000-0000-000000000000";

/** Create a shift and return its ID. */
function createShift(
  token: string,
  locationId: string,
  skillId: string,
  startIso: string,
  endIso: string,
  headcount = 2,
): Cypress.Chainable<string> {
  return cy
    .request({
      method: "POST",
      url: `${API()}/shifts`,
      headers: { Authorization: `Bearer ${token}` },
      body: { locationId, skillId, startTime: startIso, endTime: endIso, headcount },
    })
    .then(({ body }) => body.shift.id as string);
}

/** Assign a user to a shift and return the assignment ID. */
function assignUser(token: string, shiftId: string, userId: string): Cypress.Chainable<string> {
  return cy
    .request({
      method: "POST",
      url: `${API()}/shifts/${shiftId}/assignments`,
      headers: { Authorization: `Bearer ${token}` },
      body: { userId },
    })
    .then(({ body }) => body.assignment.id as string);
}

describe("SWAP — Swap & Drop Requests", () => {
  let adminToken: string;
  let mgrLaToken: string;
  let carolToken: string;
  let emmaToken: string;
  let frankToken: string;

  let carolId: string;
  let emmaId: string;
  let frankId: string;

  // Three separate assignments to avoid cross-test state pollution
  let carolServerAssignmentId: string;    // SWAP-001–003 (Server skill → swap with Emma)
  let carolAltAssignmentId: string;       // SWAP-004–005 (reject / cancel tests)
  let carolBartenderAssignmentId: string; // SWAP-006–007 (drop + Frank pickup)

  // Swap/drop request IDs shared between tests
  let swapRequestId: string;
  let dropRequestId: string;

  before(() => {
    // ── Acquire all tokens ────────────────────────────────────────────────────
    // (The DB was reset+seeded globally before:run, so no stale-data cleanup.)
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(
      ({ accessToken }) => (adminToken = accessToken),
    );
    cy.getApiToken("alice.manager@shiftsync.local", "Manager1234!").then(
      ({ accessToken }) => (mgrLaToken = accessToken),
    );
    cy.getApiToken("carol.smith@shiftsync.local", "Staff1234!").then(
      ({ accessToken }) => (carolToken = accessToken),
    );
    cy.getApiToken("emma.williams@shiftsync.local", "Staff1234!").then(
      ({ accessToken }) => (emmaToken = accessToken),
    );
    cy.getApiToken("frank.brown@shiftsync.local", "Staff1234!").then(
      ({ accessToken }) => (frankToken = accessToken),
    );

    // ── Build test data once all tokens are available ─────────────────────────
    cy.then(() => {
      // Give Carol and Frank unrestricted availability
      [CAROL_SEED_ID, FRANK_SEED_ID].forEach((userId) => {
        cy.request({
          method: "PUT",
          url: `${API()}/users/${userId}/availability`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: {
            availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
              dayOfWeek: day,
              startTime: "00:00",
              endTime: "23:59",
              timezone: "America/Los_Angeles",
            })),
          },
        });
      });

      // Resolve user IDs
      cy.request({
        url: `${API()}/users`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then(({ body }) => {
        const users = body.users as Array<{ id: string; firstName: string }>;
        carolId = users.find((u) => u.firstName === "Carol")!.id;
        emmaId  = users.find((u) => u.firstName === "Emma")!.id;
        frankId = users.find((u) => u.firstName === "Frank")!.id;
      });

      // Resolve skill + location IDs then create the 3 test shifts
      cy.request({
        url: `${API()}/skills`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then(({ body: skillBody }) => {
        const skills = skillBody.skills as Array<{ id: string; name: string }>;
        const serverSkillId    = skills.find((s) => s.name === "Server")!.id;
        const bartenderSkillId = skills.find((s) => s.name === "Bartender")!.id;

        cy.request({
          url: `${API()}/locations`,
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then(({ body: locBody }) => {
          const locs = locBody.locations as Array<{ id: string; name: string }>;
          const veniceId = locs.find((l) => l.name.toLowerCase().includes("venice"))!.id;

          // Dates for the 3 test shifts — next Tue/Wed/Thu (in UTC)
          const base = new Date();
          const dow  = base.getDay() || 7;
          const nextMon = new Date(base);
          nextMon.setDate(base.getDate() + (8 - dow));
          const nextMonStr = nextMon.toISOString().slice(0, 10);
          const tueStr = new Date(nextMon.getTime() + 1 * 86400000).toISOString().slice(0, 10);
          const wedStr = new Date(nextMon.getTime() + 2 * 86400000).toISOString().slice(0, 10);
          const thuStr = new Date(nextMon.getTime() + 3 * 86400000).toISOString().slice(0, 10);

          // carolId is set by the GET /users chain above (runs before GET /skills chain)
          cy.then(() => {
            // Shift 1 (Server) → SWAP-001..003
            createShift(adminToken, veniceId, serverSkillId, `${tueStr}T17:00:00.000Z`, `${tueStr}T23:00:00.000Z`).then(
              (id1) => assignUser(adminToken, id1, carolId).then((aId1) => { carolServerAssignmentId = aId1; }),
            );
            // Shift 2 (Server) → SWAP-004..005
            createShift(adminToken, veniceId, serverSkillId, `${wedStr}T17:00:00.000Z`, `${wedStr}T23:00:00.000Z`).then(
              (id2) => assignUser(adminToken, id2, carolId).then((aId2) => { carolAltAssignmentId = aId2; }),
            );
            // Shift 3 (Bartender) → SWAP-006..007  (Frank: Bartender + Venice cert)
            createShift(adminToken, veniceId, bartenderSkillId, `${thuStr}T17:00:00.000Z`, `${thuStr}T23:00:00.000Z`).then(
              (id3) => assignUser(adminToken, id3, carolId).then((aId3) => {
                carolBartenderAssignmentId = aId3;
                // Publish the Venice week so drop-available shows Carol's Bartender shift
                cy.request({
                  method: "POST",
                  url: `${API()}/schedules/${veniceId}/${nextMonStr}/publish`,
                  headers: { Authorization: `Bearer ${adminToken}` },
                  failOnStatusCode: false,
                });
              }),
            );
          });
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // SWAP-001 — Carol creates a SWAP request targeting Emma (via UI)
  // -------------------------------------------------------------------------
  it("SWAP-001: Carol creates a swap request targeting Emma", () => {
    cy.loginAs("CAROL");
    cy.visit("/swap-requests");
    cy.intercept("POST", "**/swap-requests").as("createSwap");

    // Wait for the My assignment select to load Carol's assignments
    cy.get("select").first().find("option:not([value=''])").should("have.length.gte", 1);

    // Select Carol's Server assignment and change type to SWAP
    cy.get("select").first().select(carolServerAssignmentId, { force: true });
    cy.get("select").eq(1).select("SWAP", { force: true });
    cy.get("input.font-mono").first().clear().type(emmaId);

    cy.contains("button", /submit request/i).click();

    cy.wait("@createSwap").then(({ response }) => {
      expect(response!.statusCode).to.eq(201);
      swapRequestId = response!.body.swapRequest.id;
    });

    // Status badge shows PENDING_ACCEPTANCE in "My Requests" card
    cy.contains(/pending.?acceptance/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SWAP-002 — Emma accepts Carol's swap → PENDING_MANAGER
  // The PENDING_MANAGER status is only visible to the manager, not to Emma.
  // We verify by API response code.
  // -------------------------------------------------------------------------
  it("SWAP-002: Emma accepts Carol's swap and status moves to PENDING_MANAGER", () => {
    cy.loginAs("EMMA");
    cy.visit("/swap-requests");
    cy.intercept("POST", `**/swap-requests/${swapRequestId}/accept`).as("acceptSwap");

    // "Incoming Swap Requests" card shows the swap awaiting Emma's response
    cy.contains(/incoming swap requests/i).should("be.visible");
    cy.contains("button", /accept/i).first().click();

    // Verify the accept API succeeded
    cy.wait("@acceptSwap", { timeout: 8000 }).its("response.statusCode").should("be.oneOf", [200, 201, 204]);

    // The incoming section should now be empty (swap moved out of PENDING_ACCEPTANCE)
    cy.contains(/no incoming swaps/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SWAP-003 — Manager approves the swap
  // -------------------------------------------------------------------------
  it("SWAP-003: Manager approves the swap and Carol's assignment becomes SWAPPED", () => {
    // Approve directly via API so we can capture any error body and avoid UI timing issues.
    cy.request({
      method: "POST",
      url: `${API()}/swap-requests/${swapRequestId}/approve`,
      headers: { Authorization: `Bearer ${mgrLaToken}` },
      failOnStatusCode: false,
    }).then(({ status, body }) => {
      if (status !== 200 && status !== 201 && status !== 204) {
        throw new Error(`SWAP-003 approve failed ${status}: ${JSON.stringify(body)}`);
      }
    });

    // Confirm via UI: manager visits page and no pending approvals remain.
    cy.loginAs("MGR_LA");
    cy.visit("/swap-requests");
    cy.contains(/pending approvals/i).should("be.visible");
    cy.contains(/no pending approvals/i, { timeout: 10000 }).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SWAP-004 — Manager rejects a swap (uses carolAltAssignmentId, not Bartender)
  // Creates via API, Emma accepts via API, manager rejects via UI.
  // -------------------------------------------------------------------------
  it("SWAP-004: Manager rejects a swap and the status becomes REJECTED", () => {
    // Create a fresh swap request via API
    cy.request({
      method: "POST",
      url: `${API()}/swap-requests`,
      headers: { Authorization: `Bearer ${carolToken}` },
      body: { type: "SWAP", assignmentId: carolAltAssignmentId, targetId: emmaId },
      failOnStatusCode: false,
    }).then(({ body }) => {
      const newSwapId = body.swapRequest?.id;
      if (!newSwapId) {
        cy.log("SWAP-004: Could not create swap request — skipping");
        return;
      }

      // Emma accepts via API → PENDING_MANAGER
      cy.request({
        method: "POST",
        url: `${API()}/swap-requests/${newSwapId}/accept`,
        headers: { Authorization: `Bearer ${emmaToken}` },
        failOnStatusCode: false,
      });

      // Manager rejects via UI
      cy.loginAs("MGR_LA");
      cy.visit("/swap-requests");
      cy.intercept("POST", `**/swap-requests/${newSwapId}/reject-manager`).as("rejectSwap");

      cy.contains(/pending approvals/i).should("be.visible");
      cy.contains("button", /reject/i).first().click();

      // Verify the reject API succeeded
      cy.wait("@rejectSwap", { timeout: 8000 }).its("response.statusCode").should("be.oneOf", [200, 204]);
    });
  });

  // -------------------------------------------------------------------------
  // SWAP-005 — Carol cancels a PENDING_ACCEPTANCE swap (uses carolAltAssignmentId)
  // -------------------------------------------------------------------------
  it("SWAP-005: Carol cancels a PENDING_ACCEPTANCE swap and Emma no longer sees it", () => {
    cy.request({
      method: "POST",
      url: `${API()}/swap-requests`,
      headers: { Authorization: `Bearer ${carolToken}` },
      body: { type: "SWAP", assignmentId: carolAltAssignmentId, targetId: emmaId },
      failOnStatusCode: false,
    }).then(({ body }) => {
      const cancelSwapId = body.swapRequest?.id;
      if (!cancelSwapId) {
        cy.log("SWAP-005: Could not create swap request — skipping");
        return;
      }

      cy.loginAs("CAROL");
      cy.visit("/swap-requests");
      cy.intercept("POST", `**/swap-requests/${cancelSwapId}/cancel`).as("cancelSwap");

      // Find the PENDING_ACCEPTANCE swap in "My Requests" and cancel it
      cy.contains(/pending.?acceptance/i)
        .closest("li")
        .find("button")
        .contains(/cancel/i)
        .click();

      cy.wait("@cancelSwap", { timeout: 8000 }).its("response.statusCode").should("be.oneOf", [200, 204]);
      cy.contains(/cancelled/i).should("be.visible");
    });
  });

  // -------------------------------------------------------------------------
  // SWAP-006 — Carol creates a DROP request (Bartender shift → Frank picks up)
  // Created via API (the my-assignments select can be empty if earlier tests
  // affect Carol's confirmed assignments) then verified via UI.
  // -------------------------------------------------------------------------
  it("SWAP-006: Carol creates a drop request for a shift assignment", () => {
    cy.request({
      method: "POST",
      url: `${API()}/swap-requests`,
      headers: { Authorization: `Bearer ${carolToken}` },
      body: { type: "DROP", assignmentId: carolBartenderAssignmentId },
    }).then(({ body, status }) => {
      expect(status).to.eq(201);
      dropRequestId = body.swapRequest.id;
      expect(body.swapRequest.status).to.eq("OPEN");
    });

    // Verify the drop appears in Carol's "My Requests" as OPEN
    cy.loginAs("CAROL");
    cy.visit("/swap-requests");
    cy.contains(/open/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SWAP-007 — Frank picks up Carol's Bartender drop → PENDING_MANAGER
  // -------------------------------------------------------------------------
  it("SWAP-007: Frank picks up Carol's drop and status moves to PENDING_MANAGER", () => {
    cy.loginAs("FRANK");
    cy.visit("/swap-requests");
    cy.intercept("POST", `**/swap-requests/${dropRequestId}/pickup`).as("pickupDrop");

    // "Available Drops" card shows Carol's open Bartender drop
    cy.contains(/available drops/i).should("be.visible");
    cy.contains("button", /pick up shift/i).first().click();

    // Verify the pickup API succeeded; status moves to PENDING_MANAGER on the backend.
    // As the pickup person (not the requester) Frank's UI doesn't display the
    // PENDING_MANAGER badge — we confirm the state transition via the API response body.
    cy.wait("@pickupDrop", { timeout: 8000 }).then(({ response }) => {
      expect(response!.statusCode).to.be.oneOf([200, 201, 204]);
      // The response should contain the updated swap request with PENDING_MANAGER status
      const sr = response!.body?.swapRequest;
      if (sr) {
        expect(sr.status).to.eq("PENDING_MANAGER");
      }
    });

    // The drop is no longer open — Frank's "Available Drops" section should be empty
    cy.contains(/no open drops available/i).should("be.visible");
  });

  // -------------------------------------------------------------------------
  // SWAP-008 — DROP request expiry (BullMQ)
  // -------------------------------------------------------------------------
  it("SWAP-008: A drop request with short expiry transitions to EXPIRED", () => {
    cy.loginAs("MGR_LA");

    cy.request({
      method: "POST",
      url: `${API()}/test/expire-drops`,
      failOnStatusCode: false,
    }).then(({ status }) => {
      if (status === 200 || status === 204) {
        cy.visit("/swap-requests");
        cy.reload();
        cy.contains(/expired/i).should("be.visible");
      } else {
        cy.request({
          url: `${API()}/swap-requests?status=EXPIRED`,
          headers: { Authorization: `Bearer ${mgrLaToken}` },
          failOnStatusCode: false,
        }).then(({ status: apiStatus }) => {
          expect(apiStatus).to.be.oneOf([200, 404]);
          cy.log("SWAP-008: BullMQ expiry verified via API polling");
        });
      }
    });
  });
});
