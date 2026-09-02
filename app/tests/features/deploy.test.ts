import { beforeEach, describe, expect, it } from "vitest";
import { MockAmsBackend, setMockCurrentUserKey } from "@/api/mock";
import { MockStore } from "@/api/mock/store";
import type { Asset, EquipmentModel, Location } from "@/api/types";

const locations: Location[] = [
  { id: "l1", name: "Ottawa", locationtype: "Office", parentlocation: "Ontario", isactive: true },
  { id: "l2", name: "Toronto", locationtype: "Office", parentlocation: "Ontario", isactive: true },
];

const models: EquipmentModel[] = [
  { manufacturer: "Instantel", model: "Micromate", equipmenttype: "DataLogger", assetgroup: "Seismographs", idprefix: "DL-UM", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 },
  { manufacturer: "Instantel", model: "Micromate", equipmenttype: "Geophone", assetgroup: "Seismographs", idprefix: "GEO-UM", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 },
  { manufacturer: "Instantel", model: "Micromate", equipmenttype: "Microphone", assetgroup: "Seismographs", idprefix: "SLM-UA", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: 12 },
  { manufacturer: "Generic", model: "Modem", equipmenttype: "Other", assetgroup: "Communications", idprefix: "MOD", isserialised: true, identifiertype: "Serial", defaultcalintervalmonths: null },
  { manufacturer: "N/A (service, not a manufactured unit)", model: "SIM Card", equipmenttype: "CellularService", assetgroup: "Communications", idprefix: "DST", isserialised: false, identifiertype: "ICCID", defaultcalintervalmonths: null },
];

// A plain (non-optional) mirror of StagedAsset (app/src/api/mock/store.ts, not exported) — the
// shape MockStore.forTesting's `assets` array actually requires. Asset itself declares
// `migrationsource` optional, which makes a Partial<Asset>-based builder infer `| undefined` for
// it even when every literal use supplies `null`; this local, fully-required type sidesteps that.
interface FixtureAsset {
  id: string;
  assetid: string;
  migrationsource: string | null;
  equipmentmodel: Asset["equipmentmodel"];
  serialnumber: string | null;
  homeoffice: string | null;
  lifecycle: Asset["lifecycle"];
  status: Asset["status"];
  currentlocation: string | null;
  custodian: string | null;
  currentproject: string | null;
  parentasset: string | null;
  lastcaldate: string | null;
  nextcaldue: string | null;
  retirementreason: Asset["retirementreason"];
  notes: string | null;
  carrier: string | null;
  identifiervalue: string | null;
  phonenumber: string | null;
  staticip: string | null;
}

function asset(overrides: Partial<FixtureAsset> & { id: string; assetid: string; equipmentmodel: Asset["equipmentmodel"] }): FixtureAsset {
  return {
    migrationsource: null,
    serialnumber: null,
    homeoffice: "Ottawa",
    lifecycle: "Active",
    status: "Available",
    currentlocation: "Ottawa",
    custodian: null,
    currentproject: null,
    parentasset: null,
    lastcaldate: null,
    nextcaldue: null,
    retirementreason: null,
    notes: null,
    carrier: null,
    identifiervalue: null,
    phonenumber: null,
    staticip: null,
    ...overrides,
  };
}

function makeBackend() {
  const store = MockStore.forTesting({
    assets: [
      asset({ id: "a-dl", assetid: "DL-UM-1000", equipmentmodel: models[0] }),
      asset({ id: "a-g1", assetid: "GEO-UM-1001", equipmentmodel: models[1] }),
      asset({ id: "a-g2", assetid: "GEO-UM-1002", equipmentmodel: models[1] }),
      asset({ id: "a-g3", assetid: "GEO-UM-1003", equipmentmodel: models[1] }),
      asset({ id: "a-g4", assetid: "GEO-UM-1004", equipmentmodel: models[1] }),
      asset({ id: "a-mic", assetid: "SLM-UA-1005", equipmentmodel: models[2] }),
      asset({ id: "a-mod", assetid: "MOD-1006", equipmentmodel: models[3] }),
      asset({ id: "a-sim", assetid: "DST-1007", equipmentmodel: models[4], status: "Available" }),
      asset({ id: "a-held", assetid: "GEO-UM-2000", equipmentmodel: models[1], status: "CheckedOut", custodian: "someone-else@englobecorp.com", currentlocation: null }),
      asset({ id: "a-deployed", assetid: "GEO-UM-3000", equipmentmodel: models[1], status: "Deployed", currentlocation: "Some Other Site" }),
    ],
    // a fresh copy every call — submitDeployment pushes new Site locations onto this array, and
    // the shared module-level literal must not leak a "Site-POR403" pushed by an earlier test.
    locations: [...locations],
    equipmentModels: models,
    projects: [
      { id: "p1", projectnumber: "02208928", name: "Test project", status: "Active", office: "Ottawa", pm: null },
      { id: "p2", projectnumber: "02000000", name: "Closed project", status: "Closed", office: "Ottawa", pm: null },
    ],
    idSequence: {},
  });
  return { backend: new MockAmsBackend(store), store };
}

const SEVEN_COMPONENT_DEPLOYMENT = {
  project: "02208928",
  primaryAssetId: "DL-UM-1000",
  components: [
    { assetId: "GEO-UM-1001", kitRole: "Sensor1" as const, orientation: "V" as const },
    { assetId: "GEO-UM-1002", kitRole: "Sensor2" as const, orientation: "H" as const },
    { assetId: "GEO-UM-1003", kitRole: "Sensor3" as const, orientation: "N" as const },
    { assetId: "GEO-UM-1004", kitRole: "Sensor4" as const, orientation: "E" as const },
    { assetId: "SLM-UA-1005", kitRole: "Microphone" as const },
    { assetId: "MOD-1006", kitRole: "Modem" as const },
  ],
  site: "Site-POR403",
  locationtype: "Site" as const,
  sitename: "POR-403 Substation",
  position: "POR-403",
  powersource: "Solar" as const,
  deploymentDate: "2026-03-01T09:00:00.000Z",
  clientSubmissionId: "deploy-1",
};

beforeEach(() => {
  setMockCurrentUserKey("field");
  window.localStorage.clear();
});

describe("submitDeployment — happy path (US1)", () => {
  it("deploys seven components in one Deploy transaction: one installation, seven InstallationComponent rows, all Deployed", async () => {
    const { backend, store } = makeBackend();
    const result = await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    expect(result.ok).toBe(true);

    const primary = await backend.getAsset("DL-UM-1000");
    expect(primary?.status).toBe("Deployed");
    expect(primary?.currentlocation).toBe("Site-POR403");
    expect(primary?.currentproject).toBe("02208928");

    for (const id of ["GEO-UM-1001", "GEO-UM-1002", "GEO-UM-1003", "GEO-UM-1004", "SLM-UA-1005", "MOD-1006"]) {
      const a = await backend.getAsset(id);
      expect(a?.status).toBe("Deployed");
    }

    expect(store.transactionLines.filter((l) => l.transaction === (result as { transactionId: string }).transactionId)).toHaveLength(7);
    expect(store.installations).toHaveLength(1);
    expect(store.installationComponents).toHaveLength(7);
    expect(store.installations[0].site).toBe("Site-POR403");
    expect(store.installations[0].primaryasset).toBe("DL-UM-1000");
    expect(store.installations[0].end).toBeNull();
  });

  it("creates the Site location when it doesn't already exist", async () => {
    const { backend, store } = makeBackend();
    expect(store.locations.some((l) => l.name === "Site-POR403")).toBe(false);
    await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    const site = store.locations.find((l) => l.name === "Site-POR403");
    expect(site?.locationtype).toBe("Site");
  });

  it("a permanent Component child mirrors its modem parent's status with no line of its own", async () => {
    const { backend, store } = makeBackend();
    store.relationships.push({
      id: "rel-sim", parentasset: "MOD-1006", childasset: "DST-1007",
      relationshiptype: "Component", start: "2026-01-01", end: null, createdbyline: null, closedbyline: null,
    });
    const result = await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    expect(result.ok).toBe(true);
    const sim = await backend.getAsset("DST-1007");
    expect(sim?.status).toBe("Deployed");
    const simHistory = await backend.getAssetHistory("DST-1007");
    expect(simHistory).toHaveLength(0);
  });

  it("shows the deployment in the primary's and a component's installation list (FR-021 support)", async () => {
    const { backend } = makeBackend();
    await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    const primaryInstallations = await backend.getAssetInstallations("DL-UM-1000");
    expect(primaryInstallations).toHaveLength(1);
    const sensorInstallations = await backend.getAssetInstallations("GEO-UM-1001");
    expect(sensorInstallations).toHaveLength(1);
    expect(sensorInstallations[0].id).toBe(primaryInstallations[0].id);
  });
});

describe("submitDeployment — refusals (US1)", () => {
  it("deploy.error.noPrimary — refuses a deployment naming no data logger", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitDeployment({ ...SEVEN_COMPONENT_DEPLOYMENT, primaryAssetId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("deploy.error.noPrimary");
  });

  it("deploy.error.primaryNotLogger — refuses when the named primary is not a data logger", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitDeployment({ ...SEVEN_COMPONENT_DEPLOYMENT, primaryAssetId: "GEO-UM-1001" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("deploy.error.primaryNotLogger");
      expect(result.offendingAssetId).toBe("GEO-UM-1001");
    }
  });

  it("deploy.error.notHeld — refuses an asset checked out to someone else", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitDeployment({
      ...SEVEN_COMPONENT_DEPLOYMENT,
      components: [{ assetId: "GEO-UM-2000", kitRole: "Sensor1" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("deploy.error.notHeld");
      expect(result.offendingAssetId).toBe("GEO-UM-2000");
    }
  });

  it("deploy.error.alreadyDeployed — refuses an asset already deployed elsewhere", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitDeployment({
      ...SEVEN_COMPONENT_DEPLOYMENT,
      components: [{ assetId: "GEO-UM-3000", kitRole: "Sensor1" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("deploy.error.alreadyDeployed");
      expect(result.offendingAssetId).toBe("GEO-UM-3000");
    }
  });

  it("deploy.error.orientationRequired — refuses a sensor role with no orientation given", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitDeployment({
      ...SEVEN_COMPONENT_DEPLOYMENT,
      components: [{ assetId: "GEO-UM-1001", kitRole: "Sensor1" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("deploy.error.orientationRequired");
      expect(result.offendingAssetId).toBe("GEO-UM-1001");
    }
  });

  it("deploy.error.inactiveProject — refuses a Closed project", async () => {
    const { backend } = makeBackend();
    const result = await backend.submitDeployment({ ...SEVEN_COMPONENT_DEPLOYMENT, project: "02000000" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("deploy.error.inactiveProject");
  });

  it("deploy.error.componentAlone — refuses a permanent Component named directly", async () => {
    const { backend, store } = makeBackend();
    store.relationships.push({
      id: "rel-sim2", parentasset: "MOD-1006", childasset: "DST-1007",
      relationshiptype: "Component", start: "2026-01-01", end: null, createdbyline: null, closedbyline: null,
    });
    const result = await backend.submitDeployment({
      ...SEVEN_COMPONENT_DEPLOYMENT,
      components: [...SEVEN_COMPONENT_DEPLOYMENT.components, { assetId: "DST-1007", kitRole: "Cellular" as const }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("deploy.error.componentAlone");
      expect(result.offendingAssetId).toBe("DST-1007");
    }
  });

  it("is atomic (FR-003/FR-010): a bad component in the cart records no transaction, no installation, and leaves every asset's status unchanged", async () => {
    const { backend, store } = makeBackend();
    const result = await backend.submitDeployment({
      ...SEVEN_COMPONENT_DEPLOYMENT,
      components: [...SEVEN_COMPONENT_DEPLOYMENT.components, { assetId: "GEO-UM-2000", kitRole: "Sensor1" }],
    });
    expect(result.ok).toBe(false);
    expect(store.installations).toHaveLength(0);
    expect(store.transactions).toHaveLength(0);
    const primary = await backend.getAsset("DL-UM-1000");
    expect(primary?.status).toBe("Available");
    const mic = await backend.getAsset("SLM-UA-1005");
    expect(mic?.status).toBe("Available");
  });

  it("is idempotent (FR-007): resubmitting the same clientSubmissionId records one transaction and one installation", async () => {
    const { backend, store } = makeBackend();
    const r1 = await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    const r2 = await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(store.transactions).toHaveLength(1);
    expect(store.installations).toHaveLength(1);
    expect(store.installationComponents).toHaveLength(7);
  });
});

async function deploySevenComponentStation(backend: MockAmsBackend) {
  const result = await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
  if (!result.ok) throw new Error(`fixture deployment failed: ${result.reason}`);
  const installations = await backend.getAssetInstallations("DL-UM-1000");
  return installations[0].id;
}

describe("submitRecovery — happy path and partial recovery (US2)", () => {
  it("full recovery closes every InstallationComponent and the Installation itself, with an end date (FR-014)", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);

    const result = await backend.submitRecovery({
      installationId,
      components: [
        { assetId: "DL-UM-1000", disposition: "Recovered" },
        { assetId: "GEO-UM-1001", disposition: "Recovered" },
        { assetId: "GEO-UM-1002", disposition: "Recovered" },
        { assetId: "GEO-UM-1003", disposition: "Recovered" },
        { assetId: "GEO-UM-1004", disposition: "Recovered" },
        { assetId: "SLM-UA-1005", disposition: "Recovered" },
        { assetId: "MOD-1006", disposition: "Recovered" },
      ],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-1",
    });
    expect(result.ok).toBe(true);

    const installation = store.installations.find((i) => i.id === installationId)!;
    expect(installation.end).toBe("2026-06-01T09:00:00.000Z");
    const rows = store.installationComponents.filter((c) => c.installation === installationId);
    expect(rows.every((r) => r.end !== null)).toBe(true);

    // FR-013: recovered components land in the recovering user's custody.
    const primary = await backend.getAsset("DL-UM-1000");
    expect(primary?.status).toBe("CheckedOut");
    expect(primary?.custodian).toBe("tech@englobecorp.com");
  });

  it("partial recovery leaves the Installation open and getInstallationSnapshot returns exactly the remaining components (FR-015)", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);

    const result = await backend.submitRecovery({
      installationId,
      components: [
        { assetId: "GEO-UM-1001", disposition: "Recovered" },
        { assetId: "GEO-UM-1002", disposition: "Recovered" },
        { assetId: "GEO-UM-1003", disposition: "Recovered" },
      ],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-partial",
    });
    expect(result.ok).toBe(true);

    const installation = store.installations.find((i) => i.id === installationId)!;
    expect(installation.end).toBeNull();

    const snapshot = await backend.getInstallationSnapshot(installationId, "2026-07-01T00:00:00.000Z");
    const remaining = snapshot?.components.map((c) => c.asset).sort();
    expect(remaining).toEqual(["DL-UM-1000", "GEO-UM-1004", "MOD-1006", "SLM-UA-1005"].sort());
  });

  it("recover.error.leaveBehindUndecided — refuses recovering the primary while components remain unaccounted for (FR-018)", async () => {
    const { backend } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);

    const result = await backend.submitRecovery({
      installationId,
      components: [{ assetId: "DL-UM-1000", disposition: "Recovered" }],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-lb-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("recover.error.leaveBehindUndecided");
  });

  it("accepts the leave-behind decision and recovers just the primary, leaving the rest on site", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);

    const result = await backend.submitRecovery({
      installationId,
      components: [{ assetId: "DL-UM-1000", disposition: "Recovered" }],
      leaveBehind: [
        { assetId: "GEO-UM-1001", reason: "left for continued monitoring" },
        { assetId: "GEO-UM-1002", reason: "left for continued monitoring" },
        { assetId: "GEO-UM-1003", reason: "left for continued monitoring" },
        { assetId: "GEO-UM-1004", reason: "left for continued monitoring" },
        { assetId: "SLM-UA-1005", reason: "left for continued monitoring" },
        { assetId: "MOD-1006", reason: "left for continued monitoring" },
      ],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-lb-2",
    });
    expect(result.ok).toBe(true);
    const installation = store.installations.find((i) => i.id === installationId)!;
    expect(installation.end).toBeNull();
  });

  it("a component marked Missing becomes Missing, not falsely recovered (FR-016)", async () => {
    const { backend } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);

    const result = await backend.submitRecovery({
      installationId,
      components: [{ assetId: "GEO-UM-1004", disposition: "Missing" }],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-missing",
    });
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("GEO-UM-1004");
    expect(asset?.status).toBe("Missing");
  });

  it("a recovered component with condition Damaged does not become Available (FR-017)", async () => {
    const { backend } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);

    const result = await backend.submitRecovery({
      installationId,
      components: [{ assetId: "MOD-1006", disposition: "Recovered", condition: "Damaged" }],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-damaged",
    });
    expect(result.ok).toBe(true);
    const asset = await backend.getAsset("MOD-1006");
    expect(asset?.status).toBe("NeedsRepair");
    expect(asset?.status).not.toBe("Available");
  });

  it("recover.error.notInstalled — refuses an asset that is not part of this installation", async () => {
    const { backend } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);
    const result = await backend.submitRecovery({
      installationId,
      components: [{ assetId: "GEO-UM-2000", disposition: "Recovered" }],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-bad-asset",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("recover.error.notInstalled");
  });
});

describe("Site reads (US3)", () => {
  it("listSites / getSiteInstallations / getInstallationSnapshot round-trip", async () => {
    const { backend } = makeBackend();
    await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);

    const allSites = await backend.listSites();
    expect(allSites.map((s) => s.name)).toContain("Site-POR403");

    const currentSites = await backend.listSites(true);
    expect(currentSites.map((s) => s.name)).toContain("Site-POR403");

    const installations = await backend.getSiteInstallations("Site-POR403");
    expect(installations).toHaveLength(1);

    const snapshot = await backend.getInstallationSnapshot(installations[0].id, "2026-04-01T00:00:00.000Z");
    expect(snapshot?.components).toHaveLength(7);
  });

  it("a closed installation and closed project remain fully readable (FR-023)", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);
    await backend.submitRecovery({
      installationId,
      components: [
        { assetId: "DL-UM-1000", disposition: "Recovered" },
        { assetId: "GEO-UM-1001", disposition: "Recovered" },
        { assetId: "GEO-UM-1002", disposition: "Recovered" },
        { assetId: "GEO-UM-1003", disposition: "Recovered" },
        { assetId: "GEO-UM-1004", disposition: "Recovered" },
        { assetId: "SLM-UA-1005", disposition: "Recovered" },
        { assetId: "MOD-1006", disposition: "Recovered" },
      ],
      recoveryDate: "2026-06-01T09:00:00.000Z",
      clientSubmissionId: "recover-close",
    });
    // Close the project too, mirroring "site whose project has closed" (spec edge case).
    const project = store.projects.find((p) => p.projectnumber === "02208928")!;
    project.status = "Closed";

    const installations = await backend.getSiteInstallations("Site-POR403");
    expect(installations).toHaveLength(1);
    expect(installations[0].end).not.toBeNull();
    const snapshot = await backend.getInstallationSnapshot(installationId, "2026-04-01T00:00:00.000Z");
    expect(snapshot?.components).toHaveLength(7); // readable as at a date within its lifespan
  });
});

describe("cross-cutting — FR-029/FR-030 (Phase 7 T040)", () => {
  it("FR-029: refuses to retire an asset recorded as deployed until it is recovered", async () => {
    const { backend } = makeBackend();
    await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    setMockCurrentUserKey("admin");
    const result = await backend.retireAsset("DL-UM-1000", "Obsolete", "retire-while-deployed");
    expect(result.ok).toBe(false);
    const asset = await backend.getAsset("DL-UM-1000");
    expect(asset?.lifecycle).toBe("Active"); // unaffected by the refused attempt
  });

  it("FR-030: a deployed asset with calibration due still appears in the calibration due list, with its site and project", async () => {
    const { backend, store } = makeBackend();
    store.assets.set("DL-UM-1000", { ...store.assets.get("DL-UM-1000")!, nextcaldue: "2026-01-01" }); // already overdue
    await backend.submitDeployment(SEVEN_COMPONENT_DEPLOYMENT);
    const due = await backend.listCalibrationDue(365);
    const primary = due.find((a) => a.assetid === "DL-UM-1000");
    expect(primary).toBeDefined();
    expect(primary?.status).toBe("Deployed");
    expect(primary?.currentlocation).toBe("Site-POR403");
    expect(primary?.currentproject).toBe("02208928");
  });
});

describe("submitComponentSwap / submitConfigurationChange (US4)", () => {
  it("swaps a component: outgoing recovered, incoming deployed, installation.start unchanged, no gap in coverage (FR-024/FR-026)", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);
    const originalStart = store.installations.find((i) => i.id === installationId)!.start;

    // A spare geophone, available, to swap in.
    store.assets.set(
      "GEO-UM-9999",
      asset({ id: "a-spare", assetid: "GEO-UM-9999", equipmentmodel: models[1] })
    );

    const result = await backend.submitComponentSwap({
      installationId,
      outgoingAssetId: "GEO-UM-1001",
      incomingAssetId: "GEO-UM-9999",
      kitRole: "Sensor1",
      orientation: "V",
      effectiveDate: "2026-04-15T09:00:00.000Z",
      reason: "geophone 1001 failed",
      clientSubmissionId: "swap-1",
    });
    expect(result.ok).toBe(true);

    const installation = store.installations.find((i) => i.id === installationId)!;
    expect(installation.start).toBe(originalStart); // FR-026

    const outgoing = await backend.getAsset("GEO-UM-1001");
    expect(outgoing?.status).toBe("CheckedOut");
    const incoming = await backend.getAsset("GEO-UM-9999");
    expect(incoming?.status).toBe("Deployed");

    // No gap: the outgoing component is in before the swap date, the incoming one after.
    const before = await backend.getInstallationSnapshot(installationId, "2026-04-01T00:00:00.000Z");
    const after = await backend.getInstallationSnapshot(installationId, "2026-05-01T00:00:00.000Z");
    expect(before?.components.map((c) => c.asset)).toContain("GEO-UM-1001");
    expect(after?.components.map((c) => c.asset)).toContain("GEO-UM-9999");
    expect(after?.components.map((c) => c.asset)).not.toContain("GEO-UM-1001");
  });

  it("swap.error.incomingUnavailable — refuses an incoming asset that is neither Available nor held by the caller", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);
    store.assets.set(
      "GEO-UM-9998",
      asset({ id: "a-spare2", assetid: "GEO-UM-9998", equipmentmodel: models[1], status: "CheckedOut", custodian: "someone-else@englobecorp.com" })
    );
    const result = await backend.submitComponentSwap({
      installationId,
      outgoingAssetId: "GEO-UM-1001",
      incomingAssetId: "GEO-UM-9998",
      kitRole: "Sensor1",
      orientation: "V",
      effectiveDate: "2026-04-15T09:00:00.000Z",
      reason: "geophone 1001 failed",
      clientSubmissionId: "swap-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("swap.error.incomingUnavailable");
  });

  it("an orientation change is recorded as a dated transaction, not an in-place edit, and the previous value stays in history (FR-025, Principle II)", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);

    const beforeHistory = await backend.getAssetHistory("GEO-UM-1001");
    const linesBefore = beforeHistory.length;

    const result = await backend.submitConfigurationChange({
      installationId,
      orientationChanges: [{ assetId: "GEO-UM-1001", orientation: "H" }],
      effectiveDate: "2026-04-20T09:00:00.000Z",
      reason: "corrected orientation after site review",
      clientSubmissionId: "config-1",
    });
    expect(result.ok).toBe(true);

    const afterHistory = await backend.getAssetHistory("GEO-UM-1001");
    expect(afterHistory.length).toBe(linesBefore + 1); // new line, old one still there

    const row = store.installationComponents.find(
      (c) => c.installation === installationId && c.asset === "GEO-UM-1001" && c.end === null
    );
    expect(row?.orientation).toBe("H");
  });

  it("config.error.noChange — refuses a configuration change with no field supplied", async () => {
    const { backend } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);
    const result = await backend.submitConfigurationChange({
      installationId,
      effectiveDate: "2026-04-20T09:00:00.000Z",
      reason: "no-op",
      clientSubmissionId: "config-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("config.error.noChange");
  });

  it("moving the station to another project updates every open component's installation record in one action (FR-027)", async () => {
    const { backend, store } = makeBackend();
    const installationId = await deploySevenComponentStation(backend);
    store.projects.push({ id: "p3", projectnumber: "09999999", name: "New project", status: "Active", office: "Ottawa", pm: null });

    const result = await backend.submitConfigurationChange({
      installationId,
      toproject: "09999999",
      effectiveDate: "2026-04-20T09:00:00.000Z",
      reason: "station reassigned",
      clientSubmissionId: "config-3",
    });
    expect(result.ok).toBe(true);
    const installation = store.installations.find((i) => i.id === installationId)!;
    expect(installation.project).toBe("09999999");
  });
});
