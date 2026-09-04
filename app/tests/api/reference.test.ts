/**
 * Rule 7 — mock reference commands: create / edit / deactivate, never delete.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createReferenceMethods } from "@/api/mock/reference";
import { MockStore } from "@/api/mock/store";
import type { EquipmentModel, Location } from "@/api/types";

function store(): MockStore {
  const models: EquipmentModel[] = [
    {
      manufacturer: "Instantel",
      model: "Micromate",
      equipmenttype: "DataLogger",
      assetgroup: "Seismographs",
      idprefix: "DL",
      isserialised: true,
      identifiertype: "Serial",
      defaultcalintervalmonths: 12,
      isactive: true,
    },
  ];
  return MockStore.forTesting({
    assets: [],
    equipmentModels: models,
    locations: [
      { id: "loc-1", name: "Ottawa", locationtype: "Office", parentlocation: "Ontario", isactive: true },
    ] satisfies Location[],
    projects: [{ id: "p1", projectnumber: "P-1", name: "Job one", status: "Active", office: "Ottawa", pm: null }],
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("createReferenceMethods", () => {
  it("creates, edits and deactivates a manufacturer; delete is not a method", async () => {
    const ref = createReferenceMethods(store());
    const created = await ref.createReference({
      domain: "Manufacturer",
      clientSubmissionId: "c1",
      reason: "add",
      attributes: { name: "Acme" },
    });
    expect(created.ok).toBe(true);
    const listed = await ref.listManufacturers();
    expect(listed.some((m) => m.name === "Acme" && m.isactive)).toBe(true);

    const edited = await ref.editReference({
      domain: "Manufacturer",
      id: "Acme",
      clientSubmissionId: "e1",
      reason: "rename",
      attributes: { name: "Acme Instruments" },
    });
    expect(edited.ok).toBe(true);

    const off = await ref.deactivateReference({
      domain: "Manufacturer",
      id: "Acme",
      clientSubmissionId: "d1",
      reason: "stop using",
    });
    expect(off.ok).toBe(true);
    expect((await ref.listManufacturers()).find((m) => m.id === "Acme")?.isactive).toBe(false);

    expect(ref).not.toHaveProperty("deleteReference");
  });

  it("refuses a typed manufacturer when creating a model", async () => {
    const ref = createReferenceMethods(store());
    const result = await ref.createReference({
      domain: "EquipmentModel",
      clientSubmissionId: "m1",
      reason: "typed",
      attributes: {
        manufacturer: "NotReal",
        model: "X",
        equipmenttype: "DataLogger",
        assetgroup: "Seismographs",
        idprefix: "XX",
        isserialised: true,
        identifiertype: "Serial",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/reference\.notFound/);
  });

  it("creates a location and refuses a cyclic reparent", async () => {
    const ref = createReferenceMethods(store());
    const a = await ref.createReference({
      domain: "Location",
      clientSubmissionId: "l1",
      reason: "parent",
      attributes: { name: "Site A", locationtype: "Site" },
    });
    const b = await ref.createReference({
      domain: "Location",
      clientSubmissionId: "l2",
      reason: "child",
      attributes: { name: "Site B", locationtype: "Site", parentlocation: "Site A" },
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const cycle = await ref.reparentLocation({
      domain: "Location",
      id: a.transactionId,
      newParentId: b.transactionId,
      clientSubmissionId: "l3",
      reason: "cycle",
    });
    expect(cycle.ok).toBe(false);
    if (cycle.ok) return;
    expect(cycle.reason).toMatch(/reference\.cycle/);
  });

  it("closes a project on deactivate", async () => {
    const ref = createReferenceMethods(store());
    const off = await ref.deactivateReference({
      domain: "Project",
      id: "p1",
      clientSubmissionId: "p-off",
      reason: "done",
    });
    expect(off.ok).toBe(true);
    const listed = (await ref.listReference("Project")) as Array<{ status: string }>;
    expect(listed[0]?.status).toBe("Closed");
  });
});
