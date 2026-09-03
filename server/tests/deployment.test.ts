/**
 * Feature 005 — Deployment & Kits over HTTP.
 *
 * Deployment and swap dates are given explicitly rather than defaulted to "now", because the
 * point-in-time snapshot (FR-020, acceptance question 7) is the whole reason the installation
 * tables exist and it can only be asserted against known dates.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, Installation, InstallationSnapshot, Location } from "../../app/src/api/types";
import { createTestApp, getJson, newSubmissionId, submit, type TestApp } from "./helpers";

let t: TestApp;

const PRIMARY = "DL-MP-12708";
const SENSOR_A = "GEO-SE-12716";
const SENSOR_B = "GEO-SE-12717";
const SWAP_PRIMARY = "DL-MP-12709";
const SWAP_OUT = "GEO-SE-13076";
const SWAP_IN = "GEO-SE-13077";
const NOT_A_LOGGER = "GEO-SE-13113";
const PROJECT = "01937805";
const SITE = "337 Test Power Street";
const SWAP_SITE = "88 Swap Crescent";

const DEPLOY_AT = "2026-09-01T12:00:00.000Z";
const SWAP_AT = "2026-09-02T12:00:00.000Z";

let installationId = "";
let swapInstallationId = "";

beforeAll(async () => {
  t = await createTestApp();
  await t.db.query(
    "INSERT INTO project (id, projectnumber, name, status, office, pm) VALUES ($1,$2,$3,'Closed',NULL,NULL)",
    ["test-closed-project", "09999999", "Closed test project"]
  );
}, 60_000);

afterAll(async () => {
  await t?.close();
});

function asset(assetId: string): Promise<Asset> {
  return getJson<Asset>(t.app, `/api/assets/${assetId}`, "admin");
}

function deployBody(overrides: Record<string, unknown> = {}) {
  return {
    project: PROJECT,
    primaryAssetId: PRIMARY,
    components: [
      { assetId: SENSOR_A, kitRole: "Sensor1", orientation: "V" },
      { assetId: SENSOR_B, kitRole: "Sensor2", orientation: "H" },
    ],
    site: SITE,
    locationtype: "Site",
    sitename: SITE,
    powersource: "Solar",
    deploymentDate: DEPLOY_AT,
    clientSubmissionId: newSubmissionId("deploy"),
    ...overrides,
  };
}

describe("deploy (US1)", () => {
  it("refuses a deployment whose primary is not a data logger (FR-002/FR-009)", async () => {
    const outcome = await submit(
      t.app,
      "/api/deployments",
      deployBody({ primaryAssetId: NOT_A_LOGGER, components: [] }),
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // An i18n key, not English: DeployPage passes the reason through describeRefusal → t().
    expect(outcome.reason).toBe("deploy.error.primaryNotLogger");
    expect(outcome.offendingAssetId).toBe(NOT_A_LOGGER);
  });

  it("refuses a deployment with no primary", async () => {
    const outcome = await submit(t.app, "/api/deployments", deployBody({ primaryAssetId: "" }), "admin");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("deploy.error.noPrimary");
  });

  it("refuses a sensor role with no orientation (FR-004)", async () => {
    const outcome = await submit(
      t.app,
      "/api/deployments",
      deployBody({ components: [{ assetId: SENSOR_A, kitRole: "Sensor1" }] }),
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("deploy.error.orientationRequired");
    expect(outcome.offendingAssetId).toBe(SENSOR_A);
  });

  it("refuses a deployment onto an inactive project", async () => {
    const outcome = await submit(t.app, "/api/deployments", deployBody({ project: "09999999" }), "admin");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("deploy.error.inactiveProject");
  });

  it("deploys the station, creating the site, the installation and one component row per asset", async () => {
    const outcome = await submit(t.app, "/api/deployments", deployBody(), "admin");
    expect(outcome.ok).toBe(true);

    for (const id of [PRIMARY, SENSOR_A, SENSOR_B]) {
      const a = await asset(id);
      expect(a.status).toBe("Deployed");
      expect(a.currentlocation).toBe(SITE);
      expect(a.currentproject).toBe(PROJECT);
    }
    expect((await asset(SENSOR_A)).parentasset).toBe(PRIMARY); // the Deploy opened a Kit relationship

    const sites = await getJson<Location[]>(t.app, "/api/sites", "admin");
    const created = sites.find((s) => s.name === SITE);
    expect(created?.locationtype).toBe("Site");

    const installations = await getJson<Installation[]>(t.app, `/api/sites/${encodeURIComponent(SITE)}/installations`, "admin");
    expect(installations).toHaveLength(1);
    installationId = installations[0].id;
    expect(installations[0].end).toBeNull();
    expect(installations[0].primaryasset).toBe(PRIMARY);
    expect(installations[0].powersource).toBe("Solar");
    expect(installations[0].start).toBe(DEPLOY_AT);

    const snapshot = await getJson<InstallationSnapshot>(
      t.app,
      `/api/installations/${installationId}/snapshot?asOf=${encodeURIComponent(DEPLOY_AT)}`,
      "admin"
    );
    expect(snapshot.components).toHaveLength(3);
    expect(snapshot.components.find((c) => c.asset === SENSOR_A)).toEqual({
      asset: SENSOR_A,
      kitrole: "Sensor1",
      orientation: "V",
    });
  });

  it("refuses redeploying an asset that is already deployed (FR-008)", async () => {
    const outcome = await submit(
      t.app,
      "/api/deployments",
      deployBody({ site: "Another Site", sitename: "Another Site", components: [] }),
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("deploy.error.alreadyDeployed");
    expect(outcome.offendingAssetId).toBe(PRIMARY);
  });

  it("is idempotent on a replayed deployment, writing no second installation", async () => {
    const body = deployBody({
      primaryAssetId: SWAP_PRIMARY,
      components: [{ assetId: SWAP_OUT, kitRole: "Sensor1", orientation: "V" }],
      site: SWAP_SITE,
      sitename: SWAP_SITE,
      powersource: "Battery",
    });
    const first = await submit(t.app, "/api/deployments", body, "admin");
    const replay = await submit(t.app, "/api/deployments", body, "admin");
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.transactionId).toBe(first.transactionId);

    const installations = await getJson<Installation[]>(
      t.app,
      `/api/sites/${encodeURIComponent(SWAP_SITE)}/installations`,
      "admin"
    );
    expect(installations).toHaveLength(1);
    swapInstallationId = installations[0].id;
  });
});

describe("recover (US2)", () => {
  it("refuses recovering the primary while another component's fate is undecided (FR-018)", async () => {
    const outcome = await submit(
      t.app,
      "/api/recoveries",
      {
        installationId,
        components: [{ assetId: PRIMARY, disposition: "Recovered", condition: "Good" }],
        recoveryDate: SWAP_AT,
        clientSubmissionId: newSubmissionId("recover-undecided"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("recover.error.leaveBehindUndecided");
  });

  it("refuses recovering an asset that is not part of the installation", async () => {
    const outcome = await submit(
      t.app,
      "/api/recoveries",
      {
        installationId,
        components: [{ assetId: NOT_A_LOGGER, disposition: "Recovered" }],
        recoveryDate: SWAP_AT,
        clientSubmissionId: newSubmissionId("recover-notinstalled"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("recover.error.notInstalled");
    expect(outcome.offendingAssetId).toBe(NOT_A_LOGGER);
  });

  it("a partial recovery leaves the installation open and describes what is still on site (FR-015)", async () => {
    const outcome = await submit(
      t.app,
      "/api/recoveries",
      {
        installationId,
        components: [{ assetId: SENSOR_B, disposition: "Recovered", condition: "Good" }],
        recoveryDate: SWAP_AT,
        clientSubmissionId: newSubmissionId("recover-partial"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(true);

    // FR-013: a recovered component lands in the recovering user's custody, and its location is
    // honestly unknown rather than claimed to be an office.
    const recovered = await asset(SENSOR_B);
    expect(recovered.status).toBe("CheckedOut");
    expect(recovered.custodian).toBe("admin@englobecorp.com");
    expect(recovered.currentlocation).toBeNull();

    const installations = await getJson<Installation[]>(t.app, `/api/sites/${encodeURIComponent(SITE)}/installations`, "admin");
    expect(installations[0].end).toBeNull(); // still open
    expect((await asset(PRIMARY)).status).toBe("Deployed");

    const snapshot = await getJson<InstallationSnapshot>(
      t.app,
      `/api/installations/${installationId}/snapshot?asOf=${encodeURIComponent(SWAP_AT)}`,
      "admin"
    );
    expect(snapshot.components.map((c) => c.asset).sort()).toEqual([PRIMARY, SENSOR_A].sort());
  });

  it("a full recovery closes the installation with an end date (FR-014)", async () => {
    const outcome = await submit(
      t.app,
      "/api/recoveries",
      {
        installationId,
        components: [
          { assetId: PRIMARY, disposition: "Recovered", condition: "Good" },
          { assetId: SENSOR_A, disposition: "Missing" },
        ],
        recoveryDate: SWAP_AT,
        clientSubmissionId: newSubmissionId("recover-full"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(true);

    const installations = await getJson<Installation[]>(t.app, `/api/sites/${encodeURIComponent(SITE)}/installations`, "admin");
    expect(installations[0].end).toBe(SWAP_AT);
    expect(installations[0].closedbytransaction).toBeTruthy();

    expect((await asset(PRIMARY)).status).toBe("CheckedOut");
    expect((await asset(SENSOR_A)).status).toBe("Missing"); // FR-016 — not falsely recovered

    // The site no longer has an open installation, so it drops out of the "current" list.
    const current = await getJson<Location[]>(t.app, "/api/sites?onlyCurrent=1", "admin");
    expect(current.find((s) => s.name === SITE)).toBeUndefined();
    const all = await getJson<Location[]>(t.app, "/api/sites", "admin");
    expect(all.find((s) => s.name === SITE)).toBeTruthy(); // FR-023 — history stays readable
  });

  it("refuses a recovery against an installation that is already closed", async () => {
    const outcome = await submit(
      t.app,
      "/api/recoveries",
      {
        installationId,
        components: [{ assetId: PRIMARY, disposition: "Recovered" }],
        recoveryDate: SWAP_AT,
        clientSubmissionId: newSubmissionId("recover-closed"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("already closed");
  });
});

describe("component swap and configuration change (US4)", () => {
  it("swaps a sensor in service without interrupting the installation (FR-024/FR-026)", async () => {
    const before = await getJson<Installation[]>(
      t.app,
      `/api/sites/${encodeURIComponent(SWAP_SITE)}/installations`,
      "admin"
    );
    const startBefore = before[0].start;

    const outcome = await submit(
      t.app,
      "/api/component-swaps",
      {
        installationId: swapInstallationId,
        outgoingAssetId: SWAP_OUT,
        incomingAssetId: SWAP_IN,
        kitRole: "Sensor1",
        orientation: "V",
        effectiveDate: SWAP_AT,
        reason: "Sensor reading intermittently",
        clientSubmissionId: newSubmissionId("swap"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(true);

    expect((await asset(SWAP_OUT)).status).toBe("CheckedOut"); // recovered into the swapper's hands
    expect((await asset(SWAP_IN)).status).toBe("Deployed");

    const after = await getJson<Installation[]>(t.app, `/api/sites/${encodeURIComponent(SWAP_SITE)}/installations`, "admin");
    expect(after).toHaveLength(1);
    expect(after[0].start).toBe(startBefore); // FR-026 — never restarted
    expect(after[0].end).toBeNull(); // and never interrupted

    // Acceptance question 7, both sides of the swap date: the half-open convention means the
    // incoming component is the one counted on the effective date itself.
    const atSwap = await getJson<InstallationSnapshot>(
      t.app,
      `/api/installations/${swapInstallationId}/snapshot?asOf=${encodeURIComponent(SWAP_AT)}`,
      "admin"
    );
    expect(atSwap.components.map((c) => c.asset).sort()).toEqual([SWAP_IN, SWAP_PRIMARY].sort());

    const beforeSwap = await getJson<InstallationSnapshot>(
      t.app,
      `/api/installations/${swapInstallationId}/snapshot?asOf=${encodeURIComponent(DEPLOY_AT)}`,
      "admin"
    );
    expect(beforeSwap.components.map((c) => c.asset).sort()).toEqual([SWAP_OUT, SWAP_PRIMARY].sort());
  });

  it("refuses swapping the primary data logger", async () => {
    const outcome = await submit(
      t.app,
      "/api/component-swaps",
      {
        installationId: swapInstallationId,
        outgoingAssetId: SWAP_PRIMARY,
        incomingAssetId: NOT_A_LOGGER,
        kitRole: "Primary",
        effectiveDate: SWAP_AT,
        reason: "Trying it on",
        clientSubmissionId: newSubmissionId("swap-primary"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("Swapping the primary data logger is not supported");
  });

  it("records a configuration change as a dated Audit transaction, not an edit (FR-025)", async () => {
    const outcome = await submit(
      t.app,
      "/api/configuration-changes",
      {
        installationId: swapInstallationId,
        orientationChanges: [{ assetId: SWAP_IN, orientation: "H" }],
        powersource: "AC",
        effectiveDate: SWAP_AT,
        reason: "Mains power now available on site",
        clientSubmissionId: newSubmissionId("config"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(true);

    const installations = await getJson<Installation[]>(
      t.app,
      `/api/sites/${encodeURIComponent(SWAP_SITE)}/installations`,
      "admin"
    );
    expect(installations[0].powersource).toBe("AC");

    const snapshot = await getJson<InstallationSnapshot>(
      t.app,
      `/api/installations/${swapInstallationId}/snapshot?asOf=${encodeURIComponent(SWAP_AT)}`,
      "admin"
    );
    expect(snapshot.components.find((c) => c.asset === SWAP_IN)?.orientation).toBe("H");

    // The amendment left a line of its own, and the assets are still Deployed.
    const historyTypes = (await getJson<Array<{ transactiontype: string }>>(
      t.app,
      `/api/assets/${SWAP_IN}/history`,
      "admin"
    )).map((l) => l.transactiontype);
    expect(historyTypes).toContain("Audit");
    expect((await asset(SWAP_IN)).status).toBe("Deployed");
  });

  it("refuses a configuration change that changes nothing", async () => {
    const outcome = await submit(
      t.app,
      "/api/configuration-changes",
      {
        installationId: swapInstallationId,
        effectiveDate: SWAP_AT,
        reason: "No change",
        clientSubmissionId: newSubmissionId("config-nochange"),
      },
      "admin"
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("config.error.noChange");
  });
});
