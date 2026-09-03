import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Field, Input, MessageBar, MessageBarBody, Select, Text, Title2, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { backend } from "../../api";
import { getSubmissionQueue } from "../../api/queue";
import type { Asset, Location, Project } from "../../api/types";
import { t } from "../../i18n";

export function TransferPage() {
  const [params] = useSearchParams();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [touser, setTouser] = useState("");
  const [tolocation, setTolocation] = useState("");
  const [toproject, setToproject] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.listLocations().then(setLocations);
    backend.listProjects().then((p) => setProjects(p.filter((x) => x.status === "Active")));
    const preset = params.get("asset");
    if (preset) void addAsset(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addAsset(query: string) {
    setAddError(null);
    const asset = await backend.getAsset(query);
    if (!asset) {
      setAddError(t("asset.notFound", { query }));
      return;
    }
    if (assets.some((a) => a.assetid === asset.assetid)) return;
    setAssets([...assets, asset]);
    setAddQuery("");
  }

  async function submit() {
    setError(null);
    if (!reason.trim()) {
      setError(t("transfer.reasonRequired"));
      return;
    }
    setSubmitting(true);
    // FR-036: routed through the offline queue — see CheckoutPage.tsx's identical comment.
    const outcome = await getSubmissionQueue(backend).submit("Transfer", {
      assetIds: assets.map((a) => a.assetid),
      touser: touser || null,
      tolocation: tolocation || null,
      toproject: toproject || null,
      reason,
      clientSubmissionId: `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setSubmitting(false);
    if (!outcome.delivered) {
      setQueued(true);
      setAssets([]);
      setReason("");
      return;
    }
    if (!outcome.outcome.ok) {
      setError(outcome.outcome.reason);
      return;
    }
    setConfirmation(t("transfer.confirmation", { txn: outcome.outcome.transactionName }));
    setAssets([]);
    setReason("");
  }

  if (confirmation || queued) {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <MessageBar intent={queued ? "warning" : "success"}>
          <MessageBarBody>{queued ? t("offline.submissionQueued") : confirmation}</MessageBarBody>
        </MessageBar>
        <Button
          appearance="primary"
          onClick={() => {
            setConfirmation(null);
            setQueued(false);
          }}
        >
          {t("common.back")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Title2>{t("transfer.title")}</Title2>

      <div style={{ display: "flex", gap: 8 }}>
        <Input
          style={{ flex: 1 }}
          placeholder={t("search.placeholder")}
          value={addQuery}
          onChange={(_, d) => setAddQuery(d.value)}
          onKeyDown={(e) => e.key === "Enter" && addQuery.trim() && addAsset(addQuery.trim())}
        />
        <Button appearance="primary" onClick={() => addQuery.trim() && addAsset(addQuery.trim())}>
          Add
        </Button>
      </div>
      {addError && (
        <MessageBar intent="error">
          <MessageBarBody>{addError}</MessageBarBody>
        </MessageBar>
      )}

      {assets.map((a) => (
        <div key={a.assetid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
          <Text font="monospace">{a.assetid}</Text>
          <Button size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => setAssets(assets.filter((x) => x.assetid !== a.assetid))} />
        </div>
      ))}

      <Field label={t("transfer.newCustodian")} hint="User principal name — leave blank to leave unchanged">
        <Input value={touser} onChange={(_, d) => setTouser(d.value)} placeholder="name@englobecorp.com" />
      </Field>
      <Field label={t("transfer.newLocation")}>
        <Select style={{ minWidth: 0, width: "100%" }} value={tolocation} onChange={(_, d) => setTolocation(d.value)}>
          <option value="">—</option>
          {locations.map((l) => (
            <option key={l.id} value={l.name}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("transfer.newProject")}>
        <Select style={{ minWidth: 0, width: "100%" }} value={toproject} onChange={(_, d) => setToproject(d.value)}>
          <option value="">—</option>
          {projects.map((p) => (
            <option key={p.id} value={p.projectnumber}>
              {p.projectnumber} — {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("transfer.reason")} required>
        <Input value={reason} onChange={(_, d) => setReason(d.value)} />
      </Field>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <Button appearance="primary" size="large" disabled={assets.length === 0 || submitting} onClick={submit}>
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </Button>
    </div>
  );
}
