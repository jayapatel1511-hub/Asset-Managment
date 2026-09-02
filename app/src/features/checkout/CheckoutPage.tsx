import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Text,
  Title2,
  tokens,
} from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { backend } from "../../api";
import type { Asset, Project } from "../../api/types";
import { StatusPill } from "../../components/StatusPill";
import { t } from "../../i18n";

interface CartItem {
  asset: Asset;
  kitRole?: string;
}

export function CheckoutPage() {
  const [params] = useSearchParams();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState("");
  // ASSUMPTION: Q8 (open, specs/clarifications.md) — expected return is optional, per the
  // recommendation, but offered pre-filled at +14 days so the common case takes zero typing;
  // the technician can still clear or change it. If Q8 is answered "required" instead, this
  // field just needs `required` added, no other change.
  const [expectedReturn, setExpectedReturn] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");
  const [primaryAssetId, setPrimaryAssetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    backend.listProjects().then((p) => setProjects(p.filter((x) => x.status === "Active")));
  }, []);

  useEffect(() => {
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
    if (asset.status !== "Available") {
      // FR-021 in the app layer: refuse at the point of adding, naming status and holder
      setAddError(t("cart.refusedNotAvailable", { assetId: asset.assetid, status: asset.status, custodian: asset.custodian ?? "—" }));
      return;
    }
    if (cart.some((c) => c.asset.assetid === asset.assetid)) {
      setAddError(`${asset.assetid} is already in the cart.`);
      return;
    }
    const next = [...cart, { asset }];
    setCart(next);
    if (next.length === 1) setPrimaryAssetId(asset.assetid); // first asset added is Primary by default
    setAddQuery("");
  }

  function removeAsset(assetId: string) {
    setCart(cart.filter((c) => c.asset.assetid !== assetId));
    if (primaryAssetId === assetId) setPrimaryAssetId(null);
  }

  async function submit() {
    setSubmitError(null);
    if (!project) {
      setSubmitError(t("checkout.projectRequired"));
      return;
    }
    setSubmitting(true);
    // FR-023: re-verify every asset's status at submission before committing
    for (const item of cart) {
      const fresh = await backend.getAsset(item.asset.assetid);
      if (!fresh || fresh.status !== "Available") {
        setSubmitting(false);
        setSubmitError(t("cart.changedSinceAdded", { assetId: item.asset.assetid }));
        return;
      }
    }
    const result = await backend.submitCheckout({
      lines: cart.map((c) => ({ assetId: c.asset.assetid, kitRole: c.kitRole })),
      primaryAssetId: primaryAssetId ?? undefined,
      project,
      expectedReturn: expectedReturn || null,
      notes: notes || null,
      clientSubmissionId: `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.reason);
      return;
    }
    setConfirmation(t("checkout.confirmation", { txn: result.transactionName }));
    setCart([]);
    setProject("");
    setPrimaryAssetId(null);
  }

  if (confirmation) {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <MessageBar intent="success">
          <MessageBarBody>{confirmation}</MessageBarBody>
        </MessageBar>
        <Button appearance="primary" onClick={() => setConfirmation(null)}>
          {t("checkout.title")} — {t("common.back")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Title2>{t("checkout.title")}</Title2>

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

      <div>
        <Text weight="semibold">{t("cart.title")}</Text>
        {cart.length === 0 && <Text style={{ display: "block", color: tokens.colorNeutralForeground3 }}>{t("cart.empty")}</Text>}
        {cart.map((item) => (
          <div
            key={item.asset.assetid}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}
          >
            <div>
              <Text font="monospace" weight="semibold">
                {item.asset.assetid}
              </Text>
              {primaryAssetId === item.asset.assetid && <Badge style={{ marginLeft: 6 }}>{t("cart.primary")}</Badge>}
              <br />
              <Text size={200}>{item.asset.equipmentmodel.manufacturer} {item.asset.equipmentmodel.model}</Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusPill status={item.asset.status} />
              <Button size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => removeAsset(item.asset.assetid)} aria-label={t("cart.remove")} />
            </div>
          </div>
        ))}
      </div>

      <Field label={t("checkout.project")} required>
        <Select value={project} onChange={(_, d) => setProject(d.value)}>
          <option value="" disabled>
            —
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.projectnumber}>
              {p.projectnumber} — {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("checkout.expectedReturn")}>
        <Input type="date" value={expectedReturn} onChange={(_, d) => setExpectedReturn(d.value)} />
      </Field>

      <Field label={t("checkout.notes")}>
        <Input value={notes} onChange={(_, d) => setNotes(d.value)} />
      </Field>

      {submitError && (
        <MessageBar intent="error">
          <MessageBarBody>{submitError}</MessageBarBody>
        </MessageBar>
      )}

      <Button appearance="primary" size="large" disabled={cart.length === 0 || submitting} onClick={submit}>
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </Button>
    </div>
  );
}
