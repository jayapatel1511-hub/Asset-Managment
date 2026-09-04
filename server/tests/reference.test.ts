/**
 * Rule 7 second clause / FR-018–FR-021 — administrators create, edit and deactivate curated
 * reference records. Delete is refused (named command and database trigger).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SubmissionOutcome } from "../../packages/contracts/src/backend";
import type { EquipmentCategory, Manufacturer } from "../../packages/contracts/src/types";
import { createTestApp, get, getJson, newSubmissionId, post, type TestApp } from "./helpers";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
}, 120_000);

afterAll(async () => {
  await t?.close();
});

async function command(path: string, body: unknown, as: "admin" | "owner" | "field" | "toronto" = "admin") {
  const res = await post(t.app, path, body, as);
  return { status: res.statusCode, body: res.json() as SubmissionOutcome & { error?: string; message?: string } };
}

function sid(label: string): string {
  return newSubmissionId(label);
}

describe("reference stewardship — create / edit / deactivate", () => {
  it("creates, edits and deactivates a manufacturer; delete is refused", async () => {
    const name = `TestMfr-${sid("mfr")}`;
    const created = await command("/api/data-management/reference/commands/create", {
      domain: "Manufacturer",
      clientSubmissionId: sid("c"),
      reason: "add a supplier",
      attributes: { name },
    });
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    if (!created.body.ok) return;

    const listed = await getJson<Manufacturer[]>(t.app, "/api/data-management/reference/Manufacturer", "admin");
    expect(listed.some((m) => m.name === name && m.isactive)).toBe(true);

    const renamed = `${name}-Renamed`;
    const edited = await command("/api/data-management/reference/commands/edit", {
      domain: "Manufacturer",
      id: name,
      clientSubmissionId: sid("e"),
      reason: "correct spelling",
      attributes: { name: renamed },
    });
    expect(edited.body.ok).toBe(true);

    const deactivated = await command("/api/data-management/reference/commands/deactivate", {
      domain: "Manufacturer",
      id: name,
      clientSubmissionId: sid("d"),
      reason: "no longer used",
    });
    expect(deactivated.body.ok).toBe(true);
    const after = await getJson<Manufacturer[]>(t.app, "/api/data-management/reference/Manufacturer", "admin");
    expect(after.find((m) => m.id === name)?.isactive).toBe(false);

    const deleted = await command("/api/data-management/reference/commands/delete", {
      domain: "Manufacturer",
      id: name,
      clientSubmissionId: sid("x"),
      reason: "remove",
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(false);
    if (deleted.body.ok) return;
    expect(deleted.body.reason).toMatch(/reference\.deleteForbidden/);

    await expect(t.db.query("DELETE FROM manufacturer WHERE id = $1", [name])).rejects.toThrow(/deleteForbidden/);
  });

  it("refuses a duplicate manufacturer key", async () => {
    const name = `DupMfr-${sid("dup")}`;
    const first = await command("/api/data-management/reference/commands/create", {
      domain: "Manufacturer",
      clientSubmissionId: sid("c1"),
      reason: "first",
      attributes: { name },
    });
    expect(first.body.ok).toBe(true);
    const second = await command("/api/data-management/reference/commands/create", {
      domain: "Manufacturer",
      clientSubmissionId: sid("c2"),
      reason: "again",
      attributes: { name },
    });
    expect(second.body.ok).toBe(false);
    if (second.body.ok) return;
    expect(second.body.reason).toMatch(/reference\.duplicateKey/);
  });

  it("creates a category tree (asset group + equipment type) and a model that selects them", async () => {
    const group = `Grp-${sid("g")}`;
    const type = `Typ-${sid("t")}`;
    const mfr = `Mfr-${sid("m")}`;
    expect(
      (
        await command("/api/data-management/reference/commands/create", {
          domain: "Manufacturer",
          clientSubmissionId: sid("cm"),
          reason: "catalogue",
          attributes: { name: mfr },
        })
      ).body.ok
    ).toBe(true);
    const groupOut = await command("/api/data-management/reference/commands/create", {
      domain: "EquipmentCategory",
      clientSubmissionId: sid("cg"),
      reason: "new group",
      attributes: { name: group },
    });
    expect(groupOut.body.ok).toBe(true);
    if (!groupOut.body.ok) return;
    const typeOut = await command("/api/data-management/reference/commands/create", {
      domain: "EquipmentCategory",
      clientSubmissionId: sid("ct"),
      reason: "new type",
      attributes: { name: type, parentId: groupOut.body.transactionId },
    });
    expect(typeOut.body.ok).toBe(true);

    const modelOut = await command("/api/data-management/reference/commands/create", {
      domain: "EquipmentModel",
      clientSubmissionId: sid("mod"),
      reason: "new catalogue row",
      attributes: {
        manufacturer: mfr,
        model: `Model-${sid("mo")}`,
        equipmenttype: type,
        assetgroup: group,
        idprefix: "ZZ",
        isserialised: true,
        identifiertype: "Serial",
      },
    });
    expect(modelOut.body.ok).toBe(true);

    const typedFree = await command("/api/data-management/reference/commands/create", {
      domain: "EquipmentModel",
      clientSubmissionId: sid("bad"),
      reason: "typed manufacturer",
      attributes: {
        manufacturer: "NotARealManufacturer",
        model: "X",
        equipmenttype: type,
        assetgroup: group,
        idprefix: "QQ",
        isserialised: true,
        identifiertype: "Serial",
      },
    });
    expect(typedFree.body.ok).toBe(false);
    if (typedFree.body.ok) return;
    expect(typedFree.body.reason).toMatch(/reference\.notFound/);
  });

  it("creates, edits and deactivates a location; reparent refuses a cycle", async () => {
    const parentName = `LocP-${sid("lp")}`;
    const childName = `LocC-${sid("lc")}`;
    const parent = await command("/api/data-management/reference/commands/create", {
      domain: "Location",
      clientSubmissionId: sid("lp"),
      reason: "parent site",
      attributes: { name: parentName, locationtype: "Site" },
    });
    expect(parent.body.ok).toBe(true);
    if (!parent.body.ok) return;
    const child = await command("/api/data-management/reference/commands/create", {
      domain: "Location",
      clientSubmissionId: sid("lc"),
      reason: "child site",
      attributes: { name: childName, locationtype: "Site", parentlocation: parentName },
    });
    expect(child.body.ok).toBe(true);
    if (!child.body.ok) return;

    const cycle = await command("/api/data-management/reference/commands/reparent-location", {
      domain: "Location",
      id: parent.body.transactionId,
      newParentId: child.body.transactionId,
      clientSubmissionId: sid("cyc"),
      reason: "would cycle",
    });
    expect(cycle.body.ok).toBe(false);
    if (cycle.body.ok) return;
    expect(cycle.body.reason).toMatch(/reference\.cycle/);

    const deactivated = await command("/api/data-management/reference/commands/deactivate", {
      domain: "Location",
      id: child.body.transactionId,
      clientSubmissionId: sid("ld"),
      reason: "site closed",
    });
    expect(deactivated.body.ok).toBe(true);

    await expect(t.db.query("DELETE FROM location WHERE name = $1", [childName])).rejects.toThrow(/deleteForbidden/);
  });

  it("creates, edits and closes a project (deactivate maps to Closed)", async () => {
    const number = `P-${sid("p")}`;
    const created = await command("/api/data-management/reference/commands/create", {
      domain: "Project",
      clientSubmissionId: sid("pc"),
      reason: "new job",
      attributes: { projectnumber: number, name: "Test job", office: "Ottawa" },
    });
    expect(created.body.ok).toBe(true);
    if (!created.body.ok) return;

    const edited = await command("/api/data-management/reference/commands/edit", {
      domain: "Project",
      id: created.body.transactionId,
      clientSubmissionId: sid("pe"),
      reason: "rename",
      attributes: { name: "Test job renamed" },
    });
    expect(edited.body.ok).toBe(true);

    const closed = await command("/api/data-management/reference/commands/deactivate", {
      domain: "Project",
      id: created.body.transactionId,
      clientSubmissionId: sid("pd"),
      reason: "job finished",
    });
    expect(closed.body.ok).toBe(true);
    const row = await t.db.query<{ status: string }>("SELECT status FROM project WHERE projectnumber = $1", [number]);
    expect(row.rows[0]?.status).toBe("Closed");

    await expect(t.db.query("DELETE FROM project WHERE projectnumber = $1", [number])).rejects.toThrow(/deleteForbidden/);
  });

  it("refuses an inactive model on register", async () => {
    const mfr = (await getJson<Manufacturer[]>(t.app, "/api/data-management/reference/Manufacturer", "admin"))[0];
    const cats = await getJson<EquipmentCategory[]>(t.app, "/api/data-management/reference/EquipmentCategory", "admin");
    const group = cats.find((c) => !c.parentId && c.isactive);
    const leaf = cats.find((c) => c.parentId === group?.id && c.isactive);
    expect(mfr && group && leaf).toBeTruthy();
    if (!mfr || !group || !leaf) return;

    const modelName = `Inactive-${sid("im")}`;
    const created = await command("/api/data-management/reference/commands/create", {
      domain: "EquipmentModel",
      clientSubmissionId: sid("imc"),
      reason: "to deactivate",
      attributes: {
        manufacturer: mfr.name,
        model: modelName,
        equipmenttype: leaf.name,
        assetgroup: group.name,
        idprefix: "IN",
        isserialised: true,
        identifiertype: "Serial",
      },
    });
    expect(created.body.ok).toBe(true);
    if (!created.body.ok) return;

    const off = await command("/api/data-management/reference/commands/deactivate", {
      domain: "EquipmentModel",
      id: created.body.transactionId,
      clientSubmissionId: sid("imd"),
      reason: "retired from catalogue",
    });
    expect(off.body.ok).toBe(true);

    const register = await command(
      "/api/assets",
      {
        manufacturer: mfr.name,
        model: modelName,
        equipmenttype: leaf.name,
        serial: `S-${sid("s")}`,
        homeoffice: "Ottawa",
        clientSubmissionId: sid("reg"),
      },
      "admin"
    );
    expect(register.body.ok).toBe(false);
    if (register.body.ok) return;
    expect(register.body.reason).toMatch(/inactiveNotSelectable/);
  });

  it("refuses FieldUser and is idempotent on replay", async () => {
    const asField = await command(
      "/api/data-management/reference/commands/create",
      {
        domain: "Manufacturer",
        clientSubmissionId: sid("ff"),
        reason: "no",
        attributes: { name: "Nope" },
      },
      "field"
    );
    expect(asField.status).toBe(403);

    const key = sid("idemp");
    const name = `Idem-${key}`;
    const first = await command("/api/data-management/reference/commands/create", {
      domain: "Manufacturer",
      clientSubmissionId: key,
      reason: "once",
      attributes: { name },
    });
    expect(first.body.ok).toBe(true);
    const replay = await command("/api/data-management/reference/commands/create", {
      domain: "Manufacturer",
      clientSubmissionId: key,
      reason: "once",
      attributes: { name },
    });
    expect(replay.body.ok).toBe(true);
    if (first.body.ok && replay.body.ok) {
      expect(replay.body.transactionId).toBe(first.body.transactionId);
    }
  });

  it("returns an impact preview with an affected-asset count", async () => {
    const listed = await getJson<Manufacturer[]>(t.app, "/api/data-management/reference/Manufacturer", "admin");
    expect(listed.length).toBeGreaterThan(0);
    const res = await get(t.app, `/api/data-management/reference/Manufacturer/${encodeURIComponent(listed[0].id)}/impact`, "admin");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { affectedAssetCount: number; reversibleClass: string };
    expect(body.affectedAssetCount).toBeGreaterThanOrEqual(0);
    expect(body.reversibleClass).toBe("Reversible");
  });
});
