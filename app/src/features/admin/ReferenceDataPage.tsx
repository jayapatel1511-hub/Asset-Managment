/**
 * Admin reference stewardship — named create / edit / deactivate per domain.
 * Not a generic table editor: each domain has its own fields. Delete is not offered.
 */
import { useEffect, useMemo, useState } from "react";
import { backend } from "../../api";
import type { SubmissionOutcome } from "../../api/AmsBackend";
import type {
  EquipmentCategory,
  EquipmentModel,
  Location,
  LocationType,
  Manufacturer,
  Project,
  ReferenceDomain,
} from "../../api/types";
import { Banner } from "../../components/Banner";
import { Chip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { SearchField } from "../../components/SearchField";
import { usePageChrome } from "../../chrome/PageChrome";
import { t, type StringKey } from "../../i18n";

const DOMAINS: ReferenceDomain[] = ["Manufacturer", "EquipmentCategory", "EquipmentModel", "Location", "Project"];
const LOCATION_TYPES: LocationType[] = ["Region", "Office", "Site", "Vehicle", "CalLab", "Client", "Storage"];
const IDENTIFIER_TYPES = ["Serial", "ICCID", "IMEI", "None"] as const;

function sid(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function modelId(m: EquipmentModel): string {
  return `${m.manufacturer}|${m.model}|${m.equipmenttype}`;
}

function isActive(row: unknown, domain: ReferenceDomain): boolean {
  if (domain === "Project") return (row as Project).status === "Active";
  const r = row as { isactive?: boolean };
  return r.isactive !== false;
}

function rowId(domain: ReferenceDomain, row: unknown): string {
  if (domain === "EquipmentModel") return modelId(row as EquipmentModel);
  return String((row as { id: string }).id);
}

function rowTitle(domain: ReferenceDomain, row: unknown): string {
  if (domain === "EquipmentModel") {
    const m = row as EquipmentModel;
    return `${m.manufacturer} ${m.model} (${m.equipmenttype})`;
  }
  if (domain === "Project") {
    const p = row as Project;
    return `${p.projectnumber} — ${p.name}`;
  }
  if (domain === "Location") {
    const l = row as Location;
    return `${l.name} · ${l.locationtype}`;
  }
  if (domain === "EquipmentCategory") {
    const c = row as EquipmentCategory;
    return c.parentId ? `${c.name}` : `${c.name} (group)`;
  }
  return (row as Manufacturer).name;
}

function domainLabel(domain: ReferenceDomain): string {
  return t(`admin.reference.domain.${domain}` as StringKey);
}

export function ReferenceDataPage() {
  const [domain, setDomain] = useState<ReferenceDomain>("Manufacturer");
  const [rows, setRows] = useState<unknown[]>([]);
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [categories, setCategories] = useState<EquipmentCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ intent: "ok" | "err"; text: string } | null>(null);

  usePageChrome({ title: t("admin.reference.title"), subtitle: t("admin.reference.subtitle") });

  async function reload(next = domain) {
    const [list, mfrs, cats, locs] = await Promise.all([
      backend.listReference(next),
      backend.listManufacturers(),
      backend.listEquipmentCategories(),
      backend.listLocations(),
    ]);
    setRows(list);
    setManufacturers(mfrs);
    setCategories(cats);
    setLocations(locs);
  }

  useEffect(() => {
    void reload(domain);
  }, [domain]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) => rowTitle(domain, a).localeCompare(rowTitle(domain, b)));
    if (!q) return sorted;
    return sorted.filter((row) => rowTitle(domain, row).toLowerCase().includes(q));
  }, [rows, query, domain]);

  function resetForm() {
    setForm({});
    setReason("");
    setCreating(false);
    setEditingId(null);
  }

  async function run(op: () => Promise<SubmissionOutcome>, requiredReason = reason) {
    if (!requiredReason.trim()) {
      setMessage({ intent: "err", text: t("admin.reference.reasonHint") });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await op();
    setBusy(false);
    if (!result.ok) {
      setMessage({ intent: "err", text: result.reason });
      return;
    }
    setMessage({ intent: "ok", text: t("admin.reference.created") });
    resetForm();
    await reload();
  }

  function attributes(): Record<string, unknown> {
    if (domain === "Manufacturer") return { name: form.name };
    if (domain === "EquipmentCategory") return { name: form.name, parentId: form.parentId || null };
    if (domain === "EquipmentModel") {
      return {
        manufacturer: form.manufacturer,
        model: form.model,
        equipmenttype: form.equipmenttype,
        assetgroup: form.assetgroup,
        idprefix: form.idprefix,
        isserialised: form.isserialised === "true",
        identifiertype: form.identifiertype || "Serial",
      };
    }
    if (domain === "Location") {
      return { name: form.name, locationtype: form.locationtype, parentlocation: form.parentlocation || null };
    }
    return { projectnumber: form.projectnumber, name: form.name, office: form.office || null, pm: form.pm || null };
  }

  const groups = categories.filter((c) => !c.parentId);
  const typesForGroup = categories.filter((c) => c.parentId && (form.assetgroup ? c.parentId === `grp:${form.assetgroup}` : true));

  return (
    <Page>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>{t("admin.reference.noDelete")}</p>

      <div className="ams-chips" style={{ marginBottom: 12 }}>
        {DOMAINS.map((d) => (
          <Chip
            key={d}
            on={d === domain}
            onClick={() => {
              setDomain(d);
              resetForm();
              setQuery("");
              setMessage(null);
            }}
          >
            {domainLabel(d)}
          </Chip>
        ))}
      </div>

      {message && <Banner intent={message.intent}>{message.text}</Banner>}

      <SearchField value={query} onChange={setQuery} placeholder={t("admin.reference.search")} />

      <div className="ams-actions" style={{ margin: "12px 0" }}>
        <button type="button" className="ams-btn ams-btn-primary" onClick={() => { setCreating(true); setEditingId(null); }}>
          {t("admin.reference.create")}
        </button>
      </div>

      {(creating || editingId) && (
        <form
          className="ams-card"
          style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              editingId
                ? backend.editReference({ domain, id: editingId, attributes: attributes(), reason: reason.trim(), clientSubmissionId: sid() })
                : backend.createReference({ domain, attributes: attributes(), reason: reason.trim(), clientSubmissionId: sid() })
            );
          }}
        >
          {domain === "Manufacturer" && (
            <label className="ams-field">
              <span>{t("admin.reference.field.name")}</span>
              <input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </label>
          )}
          {domain === "EquipmentCategory" && (
            <>
              <label className="ams-field">
                <span>{t("admin.reference.field.name")}</span>
                <input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.parent")}</span>
                <select value={form.parentId ?? ""} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
                  <option value="">{t("admin.reference.root")}</option>
                  {groups.filter((g) => g.isactive).map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {domain === "EquipmentModel" && (
            <>
              <label className="ams-field">
                <span>{t("admin.reference.field.manufacturer")}</span>
                <select value={form.manufacturer ?? ""} onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))} required>
                  <option value="" />
                  {manufacturers.filter((m) => m.isactive).map((m) => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.assetgroup")}</span>
                <select value={form.assetgroup ?? ""} onChange={(e) => setForm((f) => ({ ...f, assetgroup: e.target.value, equipmenttype: "" }))} required>
                  <option value="" />
                  {groups.filter((g) => g.isactive).map((g) => (
                    <option key={g.id} value={g.name}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.equipmenttype")}</span>
                <select value={form.equipmenttype ?? ""} onChange={(e) => setForm((f) => ({ ...f, equipmenttype: e.target.value }))} required>
                  <option value="" />
                  {typesForGroup.filter((c) => c.isactive).map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.model")}</span>
                <input value={form.model ?? ""} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} required />
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.idprefix")}</span>
                <input value={form.idprefix ?? ""} onChange={(e) => setForm((f) => ({ ...f, idprefix: e.target.value }))} required />
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.identifiertype")}</span>
                <select value={form.identifiertype ?? "Serial"} onChange={(e) => setForm((f) => ({ ...f, identifiertype: e.target.value }))}>
                  {IDENTIFIER_TYPES.map((x) => (
                    <option key={x} value={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.isserialised")}</span>
                <select value={form.isserialised ?? "true"} onChange={(e) => setForm((f) => ({ ...f, isserialised: e.target.value }))}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            </>
          )}
          {domain === "Location" && (
            <>
              <label className="ams-field">
                <span>{t("admin.reference.field.name")}</span>
                <input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.locationtype")}</span>
                <select value={form.locationtype ?? "Site"} onChange={(e) => setForm((f) => ({ ...f, locationtype: e.target.value }))}>
                  {LOCATION_TYPES.map((x) => (
                    <option key={x} value={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.parentlocation")}</span>
                <select value={form.parentlocation ?? ""} onChange={(e) => setForm((f) => ({ ...f, parentlocation: e.target.value }))}>
                  <option value="" />
                  {locations.filter((l) => l.isactive).map((l) => (
                    <option key={l.id} value={l.name}>{l.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {domain === "Project" && (
            <>
              <label className="ams-field">
                <span>{t("admin.reference.field.projectnumber")}</span>
                <input value={form.projectnumber ?? ""} onChange={(e) => setForm((f) => ({ ...f, projectnumber: e.target.value }))} required disabled={!!editingId} />
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.name")}</span>
                <input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </label>
              <label className="ams-field">
                <span>{t("admin.reference.field.office")}</span>
                <select value={form.office ?? ""} onChange={(e) => setForm((f) => ({ ...f, office: e.target.value }))}>
                  <option value="" />
                  {locations.filter((l) => l.locationtype === "Office" && l.isactive).map((l) => (
                    <option key={l.id} value={l.name}>{l.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="ams-field">
            <span>{t("admin.reference.reason")}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required />
            <span className="hint">{t("admin.reference.reasonHint")}</span>
          </label>
          <div className="ams-actions">
            <button type="submit" className="ams-btn ams-btn-primary" disabled={busy}>{t("admin.reference.save")}</button>
            <button type="button" className="ams-btn" onClick={resetForm}>{t("admin.reference.cancel")}</button>
          </div>
        </form>
      )}

      <ListFrame>
        {filtered.length === 0 && <EmptyState>{t("admin.reference.empty")}</EmptyState>}
        {filtered.map((row) => {
          const id = rowId(domain, row);
          const active = isActive(row, domain);
          return (
            <div key={id} className="ams-asset-row" style={{ cursor: "default" }}>
              <div className="meta">
                <div style={{ fontWeight: 600 }}>{rowTitle(domain, row)}</div>
                <div className="sub">
                  <span className={`ams-pill ${active ? "ams-pill-ok" : "ams-pill-Retired"}`}>
                    {active ? t("admin.reference.active") : t("admin.reference.inactive")}
                  </span>
                </div>
                <div className="ams-actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="ams-btn"
                    onClick={() => {
                      setEditingId(id);
                      setCreating(false);
                      const r = row as Record<string, unknown>;
                      const cat = row as unknown as EquipmentCategory;
                      setForm({
                        name: String(r.name ?? ""),
                        parentId: String(cat.parentId ?? ""),
                        manufacturer: String(r.manufacturer ?? ""),
                        model: String(r.model ?? ""),
                        equipmenttype: String(r.equipmenttype ?? ""),
                        assetgroup: String(r.assetgroup ?? ""),
                        idprefix: String(r.idprefix ?? ""),
                        identifiertype: String(r.identifiertype ?? "Serial"),
                        isserialised: String(r.isserialised ?? true),
                        locationtype: String(r.locationtype ?? "Site"),
                        parentlocation: String(r.parentlocation ?? ""),
                        projectnumber: String(r.projectnumber ?? ""),
                        office: String(r.office ?? ""),
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={active ? "ams-btn" : "ams-btn ams-btn-primary"}
                    disabled={busy}
                    onClick={() => {
                      const nextReason = reason.trim() || (active ? "deactivate" : "reactivate");
                      void run(
                        () =>
                          active
                            ? backend.deactivateReference({ domain, id, reason: nextReason, clientSubmissionId: sid() })
                            : backend.reactivateReference({ domain, id, reason: nextReason, clientSubmissionId: sid() }),
                        nextReason
                      );
                    }}
                  >
                    {active ? t("admin.reference.deactivate") : t("admin.reference.reactivate")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </ListFrame>
    </Page>
  );
}
