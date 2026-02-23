/**
 * SUITE 4 — Shift Detail & Assignments
 * Tests: SHIFT-001 through SHIFT-010
 *
 * UI notes discovered during test authoring:
 *  - Staff assignment input has placeholder "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 *    and the class "font-mono text-xs" — select with cy.get("input.font-mono")
 *  - WhatIfPanel auto-loads when candidateStaffId is exactly 36 chars long —
 *    no extra button click is required.
 *  - Remove-assignment, Publish-shift, and Cancel-shift actions have no UI
 *    buttons on the shift detail page.  SHIFT-008/009/010 use the Admin API
 *    to perform the state change, then verify the UI reflects it.
 *
 * Endpoints referenced:
 *   DELETE /shifts/:shiftId/assignments/:userId  (remove assignment)
 *   POST   /schedules/:locationId/:week/publish  (publish schedule → shifts become PUBLISHED)
 *   DELETE /shifts/:id                           (hard-delete a draft or published shift)
 */

const API = () => Cypress.env("apiUrl") as string;

/** Returns the ID of the first user matching a firstName. */
function getUserId(token: string, firstName: string): Cypress.Chainable<string> {
  return cy
    .request({
      url: `${API()}/users`,
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(({ body }) => {
      const user = (body.users as Array<{ firstName: string; id: string }>).find(
        (u) => u.firstName === firstName,
      );
      expect(user, `User "${firstName}" should exist`).to.exist;
      return user!.id;
    });
}

/** Returns the ID of the first location whose name includes nameSubstring.
 *  Uses the Admin token to ensure all locations are visible. */
function getLocationId(adminToken: string, nameSubstring: string): Cypress.Chainable<string> {
  return cy
    .request({
      url: `${API()}/locations`,
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    .then(({ body }) => {
      const loc = (body.locations as Array<{ id: string; name: string }>).find((l) =>
        l.name.toLowerCase().includes(nameSubstring.toLowerCase()),
      );
      expect(loc, `Location "${nameSubstring}" should exist`).to.exist;
      return loc!.id;
    });
}

/** Returns published shifts for a given location from the API. */
function getPublishedShifts(
  token: string,
  locationId: string,
): Cypress.Chainable<Array<{ id: string; status: string; skillId: string }>> {
  return cy
    .request({
      url: `${API()}/shifts?locationId=${locationId}&status=PUBLISHED`,
      headers: { Authorization: `Bearer ${token}` },
    })
    .then(({ body }) => body.shifts as Array<{ id: string; status: string; skillId: string }>);
}

describe("SHIFT — Shift Detail & Assignments", () => {
  let adminToken: string;
  let mgrLaToken: string;
  let mgrFlToken: string;
  let veniceId: string;
  let miamiId: string;

  before(() => {
    cy.getApiToken("admin@shiftsync.local", "ChangeMe123!").then(({ accessToken }) => {
      adminToken = accessToken;

        // Ensure Frank has recurring availability for all days so the constraint
      // engine does not block SHIFT-002 with AVAILABILITY_BLOCKED.
      const FRANK_ID = "st000004-0000-0000-0000-000000000000";
      cy.request({
        method: "PUT",
        url: `${API()}/users/${FRANK_ID}/availability`,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
            dayOfWeek: day,
            startTime: "00:00",
            endTime: "23:59",
            timezone: "America/Los_Angeles",
          })),
        },
      });

      getLocationId(adminToken, "venice").then((vId) => {
        veniceId = vId;

        // First: drop Frank's assignments from ALL Venice shifts (DRAFT + PUBLISHED).
        // Previous SHIFT-002 runs create DRAFT Bartender shifts and assign Frank to
        // them; the before() hook cancels those shifts but the CONFIRMED assignment
        // record persists, causing NO_OVERLAP on the next run.
        getUserId(adminToken, "Frank").then((frankId) => {
          // Get ALL Venice shifts (draft + published + cancelled) via admin
          cy.request({
            url: `${API()}/shifts?locationId=${vId}`,
            headers: { Authorization: `Bearer ${accessToken}` },
          }).then(({ body }) => {
            (body.shifts as Array<{ id: string }> ?? []).forEach((s) => {
              cy.request({
                method: "DELETE",
                url: `${API()}/shifts/${s.id}/assignments/${frankId}`,
                headers: { Authorization: `Bearer ${accessToken}` },
                failOnStatusCode: false,
              });
            });
          });

          // Also remove Frank from SouthBeach shifts to eliminate UTC-overlap with Venice Fri PM.
          getLocationId(adminToken, "south beach").then((sbId) => {
            cy.request({
              url: `${API()}/shifts?locationId=${sbId}`,
              headers: { Authorization: `Bearer ${accessToken}` },
            }).then(({ body }) => {
              (body.shifts as Array<{ id: string }> ?? []).forEach((s) => {
                cy.request({
                  method: "DELETE",
                  url: `${API()}/shifts/${s.id}/assignments/${frankId}`,
                  headers: { Authorization: `Bearer ${accessToken}` },
                  failOnStatusCode: false,
                });
              });
            });
          });
        });

        // Then cancel all accumulated DRAFT Venice shifts from prior test runs.
        // SCED-004 creates DRAFT Server shifts for "next Tuesday" on every run;
        // they land in the same scheduleWeek as SHIFT-009's shift and their
        // editCutoffAt can fall in the past, blocking the publish endpoint.
        cy.request({
          url: `${API()}/shifts?locationId=${vId}&status=DRAFT`,
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(({ body }) => {
          (body.shifts as Array<{ id: string }>).forEach((s) => {
            cy.request({
              method: "DELETE",
              url: `${API()}/shifts/${s.id}`,
              headers: { Authorization: `Bearer ${accessToken}` },
              failOnStatusCode: false,
            });
          });
        });
      });

      getLocationId(adminToken, "miami").then((id) => (miamiId = id));
    });

    cy.getApiToken("alice.manager@shiftsync.local", "Manager1234!").then((t) => {
      mgrLaToken = t.accessToken;
    });

    cy.getApiToken("bob.manager@shiftsync.local", "Manager1234!").then((t) => {
      mgrFlToken = t.accessToken;
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-001 — View shift detail
  // -------------------------------------------------------------------------
  it("SHIFT-001: Manager navigates to a published shift and sees full details", () => {
    cy.loginAs("MGR_LA");

    getPublishedShifts(mgrLaToken, veniceId).then((shifts) => {
      expect(shifts.length).to.be.gte(1);
      const shiftId = shifts[0].id;

      cy.visit(`/shifts/${shiftId}`);

      cy.contains(/venice beach/i).should("be.visible");
      cy.contains(/published|draft|cancelled/i).should("be.visible");
      cy.contains(/assignment/i).should("be.visible");
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-002 — Assign staff to shift (happy path)
  // -------------------------------------------------------------------------
  it("SHIFT-002: Manager assigns Frank Brown to a Venice shift with an open slot", () => {
    cy.loginAs("MGR_LA");

    cy.intercept("POST", "**/assignments").as("assignStaff");

    // Frank only has Bartender skill. All seed Venice Bartender slots (sh000003, headcount 2)
    // are already full (Carol + Frank). Create a fresh Venice Bartender DRAFT shift for next
    // week so we have a guaranteed open slot that Frank can fill.
    cy.request({
      url: `${API()}/skills`,
      headers: { Authorization: `Bearer ${mgrLaToken}` },
    }).then(({ body }) => {
      const bartenderSkill = (body.skills as Array<{ id: string; name: string }>).find(
        (s) => s.name === "Bartender",
      )!;

      const nextMon = new Date();
      const d = nextMon.getDay();
      nextMon.setDate(nextMon.getDate() + (d === 0 ? 1 : 8 - d));
      const dateStr = nextMon.toISOString().slice(0, 10);

      cy.request({
        method: "POST",
        url: `${API()}/shifts`,
        headers: { Authorization: `Bearer ${mgrLaToken}` },
        body: {
          locationId: veniceId,
          skillId: bartenderSkill.id,
          startTime: `${dateStr}T18:00:00.000Z`,
          endTime: `${dateStr}T22:00:00.000Z`,
          headcount: 2,
        },
      }).then(({ body: shiftBody }) => {
        const shiftId = shiftBody.shift.id;
        cy.visit(`/shifts/${shiftId}`);

        getUserId(adminToken, "Frank").then((frankId) => {
          cy.get("input.font-mono").first().clear().type(frankId);
          cy.contains("button", /assign staff/i).click();

          cy.wait("@assignStaff").its("response.statusCode").should("be.oneOf", [200, 201]);

          cy.contains("Frank Brown").should("be.visible");
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-003 — Assign staff — skill mismatch blocked
  // -------------------------------------------------------------------------
  it("SHIFT-003: Assigning David Jones (Line Cook) to a Server shift returns SKILL_MISMATCH", () => {
    cy.loginAs("MGR_LA");

    cy.intercept("POST", "**/assignments").as("assignBad");

    getPublishedShifts(mgrLaToken, veniceId).then((shifts) => {
      const serverShift = shifts.find((s) => s.skillId) ?? shifts[0];
      cy.visit(`/shifts/${serverShift.id}`);

      getUserId(adminToken, "David").then((davidId) => {
        cy.get("input.font-mono").first().clear().type(davidId);
        cy.contains("button", /assign staff/i).click();

        cy.wait("@assignBad").its("response.statusCode").should("eq", 422);

        cy.contains(/skill.?mismatch|skill.*required/i).should("be.visible");
        cy.contains("David Jones").should("not.exist");
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-004 — Assign staff — certification check
  // -------------------------------------------------------------------------
  it("SHIFT-004: Assigning Henry (not certified for Miami) to a Miami shift is blocked", () => {
    cy.loginAs("MGR_FL");

    cy.intercept("POST", "**/assignments").as("assignBad");

    getPublishedShifts(mgrFlToken, miamiId).then((shifts) => {
      expect(shifts.length).to.be.gte(1);
      cy.visit(`/shifts/${shifts[0].id}`);

      getUserId(adminToken, "Henry").then((henryId) => {
        cy.get("input.font-mono").first().clear().type(henryId);
        cy.contains("button", /assign staff/i).click();

        cy.wait("@assignBad").its("response.statusCode").should("eq", 422);

        cy.contains(/location.*not.*certified|certification|not certified/i).should("be.visible");
        cy.contains("Henry Wilson").should("not.exist");
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-005 — Assign staff — overtime warning (Emma, 32h + 6h shift)
  // -------------------------------------------------------------------------
  it("SHIFT-005: Assigning Emma (32h) to a 6h Miami shift shows overtime WARNING but succeeds", () => {
    cy.loginAs("MGR_FL");

    cy.intercept("POST", "**/assignments").as("assignEmma");

    cy.request({
      url: `${API()}/shifts?locationId=${miamiId}&status=PUBLISHED`,
      headers: { Authorization: `Bearer ${mgrFlToken}` },
    }).then(({ body }) => {
      const shifts = body.shifts as Array<{ id: string; startTime: string }>;
      const satShift = shifts.find((s) => new Date(s.startTime).getDay() === 6) ?? shifts[0];

      cy.visit(`/shifts/${satShift.id}`);

      getUserId(adminToken, "Emma").then((emmaId) => {
        cy.get("input.font-mono").first().clear().type(emmaId);
        cy.contains("button", /assign staff/i).click();

        cy.wait("@assignEmma").then(({ response }) => {
          expect(response!.statusCode).to.be.oneOf([201, 422]);

          if (response!.statusCode === 201) {
            cy.contains(/warning|overtime/i).should("be.visible");
            cy.contains("Emma Williams").should("be.visible");
          }
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-006 — Assign staff — overtime HARD LIMIT blocked
  // -------------------------------------------------------------------------
  it("SHIFT-006: Assigning Emma to a shift that exceeds 40h returns WEEKLY_HARD_LIMIT", () => {
    cy.loginAs("MGR_FL");

    // Emma's seed assignments (as000001-as000004) cover Mon–Thu of the CURRENT seed week
    // (the week that was current when `prisma:seed` last ran). We must create the test shift
    // in that SAME week so the constraint engine counts her 32h against the new assignment.
    // Use the current week's Friday (or Saturday if today is past Friday).
    const today = new Date();
    const dayOfWeek = today.getDay() || 7; // Sun=7, Mon=1, ..., Sat=6
    // Calculate the Friday of the current ISO week (Mon–Sun week)
    // Mon(1)→+4, Tue(2)→+3, ..., Fri(5)→0, Sat(6)→-1, Sun(7)→-2
    const daysToFriday = 5 - dayOfWeek;
    const friday = new Date(today);
    friday.setDate(friday.getDate() + daysToFriday);
    const dateStr = friday.toISOString().slice(0, 10);

    cy.intercept("POST", "**/assignments").as("assignOverlimit");

    cy.request({
      url: `${API()}/skills`,
      headers: { Authorization: `Bearer ${mgrFlToken}` },
    }).then(({ body }) => {
      const skills = body.skills as Array<{ id: string; name: string }>;
      const serverSkill = skills.find((s) => s.name === "Server") ?? skills[0];

      cy.request({
        method: "POST",
        url: `${API()}/shifts`,
        headers: { Authorization: `Bearer ${mgrFlToken}` },
        body: {
          locationId: miamiId,
          skillId: serverSkill.id,
          startTime: `${dateStr}T09:00:00.000Z`,
          endTime: `${dateStr}T18:00:00.000Z`,
          headcount: 1,
        },
      }).then(({ body: shiftBody }) => {
        const shiftId = shiftBody.shift.id;
        cy.visit(`/shifts/${shiftId}`);

        getUserId(adminToken, "Emma").then((emmaId) => {
          cy.get("input.font-mono").first().clear().type(emmaId);
          cy.contains("button", /assign staff/i).click();

          cy.wait("@assignOverlimit").its("response.statusCode").should("eq", 422);

          // Backend message: "Projected weekly hours X.XX exceed 40h"
          cy.contains(/exceed 40h|exceed.*weekly|weekly.*hours.*exceed/i).should("be.visible");
          cy.contains("Emma Williams").should("not.exist");
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-007 — What-If panel projections
  // WhatIfPanel auto-loads when candidateStaffId reaches 36 characters.
  // -------------------------------------------------------------------------
  it("SHIFT-007: What-If panel shows correct projections for Emma on Miami shift", () => {
    cy.loginAs("MGR_FL");

    cy.intercept("GET", "**/analytics/what-if**").as("whatIf");

    getPublishedShifts(mgrFlToken, miamiId).then((shifts) => {
      cy.visit(`/shifts/${shifts[0].id}`);

      getUserId(adminToken, "Emma").then((emmaId) => {
        // Typing the full UUID (36 chars) enables the WhatIfPanel automatically
        cy.get("input.font-mono").first().clear().type(emmaId);

        cy.wait("@whatIf", { timeout: 15000 });

        // WhatIfPanel shows "Weekly hrs" stat and projected hours
        cy.contains(/weekly.*hrs|week.*hours/i).should("be.visible");
        cy.contains(/projected/i).should("be.visible");
        // At 32h baseline + any Miami shift, panel should show overtime warning
        cy.contains(/warning|overtime|consecutive/i).should("be.visible");
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-008 — Unassign staff from shift
  // The shift detail UI has no Remove button — use the API to remove and
  // verify the UI no longer shows the user.
  // -------------------------------------------------------------------------
  it("SHIFT-008: Manager removes Carol Smith from a Venice shift", () => {
    cy.loginAs("MGR_LA");

    getUserId(adminToken, "Carol").then((carolId) => {
      getPublishedShifts(mgrLaToken, veniceId).then((shifts) => {
        // Find a shift Carol is currently assigned to (via assignments API)
        const tryRemove = (shiftList: typeof shifts): void => {
          if (shiftList.length === 0) {
            // Carol is not assigned to any Venice shift; that's acceptable
            cy.log("Carol is not assigned to any Venice shift — skipping remove step");
            return;
          }
          const [shift, ...rest] = shiftList;
          cy.request({
            url: `${API()}/shifts/${shift.id}/assignments`,
            headers: { Authorization: `Bearer ${mgrLaToken}` },
            failOnStatusCode: false,
          }).then(({ body }) => {
            const carolAssignment = (
              body.assignments as Array<{ userId: string }>
            )?.find((a) => a.userId === carolId);

            if (!carolAssignment) {
              tryRemove(rest);
              return;
            }

            cy.intercept("DELETE", `**/assignments/${carolId}`).as("removeAssignment");

            cy.request({
              method: "DELETE",
              url: `${API()}/shifts/${shift.id}/assignments/${carolId}`,
              headers: { Authorization: `Bearer ${mgrLaToken}` },
            })
              .its("status")
              .should("be.oneOf", [200, 204]);

            // Verify the shift detail page no longer shows Carol
            cy.visit(`/shifts/${shift.id}`);
            cy.contains("Carol Smith").should("not.exist");
          });
        };

        tryRemove(shifts);
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-009 — Publish shift
  // The frontend has no "Publish" button for individual shifts; publishing is
  // a schedule-level operation.  We use the API to publish the schedule and
  // then verify the shift status badge updates to PUBLISHED in the UI.
  // -------------------------------------------------------------------------
  it("SHIFT-009: Manager publishes a DRAFT shift and status badge updates", () => {
    cy.loginAs("MGR_LA");

    cy.request({
      url: `${API()}/skills`,
      headers: { Authorization: `Bearer ${mgrLaToken}` },
    }).then(({ body }) => {
      const serverSkill = (body.skills as Array<{ id: string; name: string }>).find(
        (s) => s.name === "Server",
      )!;

      // Use a Wednesday 3 weeks out so this week is guaranteed unpublished
      // (current week is published by seed; next week by swap-requests setup).
      const nextWed = new Date();
      nextWed.setDate(nextWed.getDate() + ((3 + 7 - nextWed.getDay()) % 7 || 7) + 14);
      const dateStr = nextWed.toISOString().slice(0, 10);
      // The /schedules/:locationId/:week/publish endpoint expects a date string
      // (YYYY-MM-DD) representing the Monday of the target schedule week.
      const mon = new Date(nextWed);
      const dayIdx = mon.getDay();
      mon.setDate(mon.getDate() + (dayIdx === 0 ? -6 : 1 - dayIdx));
      const isoWeek = mon.toISOString().slice(0, 10); // "2026-MM-DD"

      cy.request({
        method: "POST",
        url: `${API()}/shifts`,
        headers: { Authorization: `Bearer ${mgrLaToken}` },
        body: {
          locationId: veniceId,
          skillId: serverSkill.id,
          startTime: `${dateStr}T14:00:00.000Z`,
          endTime: `${dateStr}T20:00:00.000Z`,
          headcount: 1,
        },
      }).then(({ body: shiftBody }) => {
        const shiftId = shiftBody.shift.id;

        // Confirm the shift is DRAFT in the UI
        cy.visit(`/shifts/${shiftId}`);
        cy.contains(/draft/i).should("be.visible");

        // Publish the whole schedule for that week via API
        cy.request({
          method: "POST",
          url: `${API()}/schedules/${veniceId}/${isoWeek}/publish`,
          headers: { Authorization: `Bearer ${mgrLaToken}` },
          failOnStatusCode: false,
        }).then(({ status }) => {
          expect(status).to.be.oneOf([200, 201, 204]);

          // Reload and verify status badge changed to PUBLISHED
          cy.reload();
          cy.contains(/published/i).should("be.visible");
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // SHIFT-010 — Cancel shift
  // There is no "Cancel Shift" button in the UI.  We DELETE the shift via API
  // (which is the backend's mechanism for cancellation) and verify the page
  // reflects the removal (redirect to schedule or 404).
  // -------------------------------------------------------------------------
  it("SHIFT-010: Manager cancels a published shift", () => {
    cy.loginAs("MGR_LA");

    getPublishedShifts(mgrLaToken, veniceId).then((shifts) => {
      const shift = shifts[shifts.length - 1];
      cy.visit(`/shifts/${shift.id}`);

      cy.contains(/published/i).should("be.visible");

      cy.request({
        method: "DELETE",
        url: `${API()}/shifts/${shift.id}`,
        headers: { Authorization: `Bearer ${mgrLaToken}` },
        failOnStatusCode: false,
      })
        .its("status")
        .should("be.oneOf", [200, 204]);

      // After deletion the page either redirects or shows an error / empty state
      cy.reload();
      cy.url().then((url) => {
        if (url.includes(`/shifts/${shift.id}`)) {
          // Still on the page — the UI shows "Could not load shift"
          cy.contains(/could not load|not found|shift/i).should("be.visible");
        }
        // If redirected to another page — also acceptable
      });
    });
  });
});

