/**
 * Feature 004 US4 — office → administrator assignment (FR-027/FR-027a). Owned by WS-D.
 *
 * Every office comes from `listOfficeAdminAssignments()`, which itself derives the office list
 * from store.locations (never a fixed list — see data/reference/office_admins.README.md and the
 * N-offices decision). An office with an empty `adminUpns` array is a gap (FR-027a) and is
 * visually flagged here, never silently omitted.
 *
 * There is no real directory to pick an administrator from in this mock build, so — same pattern
 * as TransferPage.tsx's "New custodian" field — a UPN is a plain text input, not a picker.
 */
import { useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, MessageBar, MessageBarBody, Spinner, Text, Title3, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { backend } from "../../api";
import type { OfficeAdminAssignment } from "../../api/types";
import { t } from "../../i18n";

export function OfficeAdminsPage() {
  const [assignments, setAssignments] = useState<OfficeAdminAssignment[] | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busyOffice, setBusyOffice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedOffice, setSavedOffice] = useState<string | null>(null);

  function load() {
    backend.listOfficeAdminAssignments().then(setAssignments);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(office: string, adminUpns: string[]) {
    setBusyOffice(office);
    setErrors((e) => ({ ...e, [office]: "" }));
    setSavedOffice(null);
    const result = await backend.setOfficeAdmins(office, adminUpns, `office-admins-${office}-${Date.now()}`);
    setBusyOffice(null);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [office]: result.reason }));
      return;
    }
    setSavedOffice(office);
    // Reflect the just-saved list immediately rather than round-tripping through the backend
    // again — setOfficeAdmins is a full replace, so the outcome IS the new state.
    setAssignments((prev) => (prev ? prev.map((a) => (a.office === office ? { office, adminUpns } : a)) : prev));
  }

  function addAdmin(office: string, current: string[]) {
    const upn = (inputs[office] ?? "").trim();
    if (!upn) return;
    if (current.some((u) => u.toLowerCase() === upn.toLowerCase())) {
      setInputs((i) => ({ ...i, [office]: "" }));
      return;
    }
    setInputs((i) => ({ ...i, [office]: "" }));
    void save(office, [...current, upn]);
  }

  function removeAdmin(office: string, current: string[], upn: string) {
    void save(
      office,
      current.filter((u) => u !== upn)
    );
  }

  const gapCount = assignments?.filter((a) => a.adminUpns.length === 0).length ?? 0;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      {!assignments && <Spinner style={{ margin: 24 }} label={t("common.loading")} />}

      {assignments && (
        <>
          {gapCount > 0 ? (
            <Card style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Text weight="semibold">{t("admin.officeAdmins.gap")}</Text>
                <Badge color="danger">{gapCount}</Badge>
              </div>
            </Card>
          ) : (
            <MessageBar intent="success">
              <MessageBarBody>{t("admin.officeAdmins.noGaps")}</MessageBarBody>
            </MessageBar>
          )}

          {assignments.map((a) => {
            const isGap = a.adminUpns.length === 0;
            return (
              <Card key={a.office} style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <Title3>{a.office}</Title3>
                  {isGap && <Badge color="danger">{t("admin.officeAdmins.gap")}</Badge>}
                </div>

                <Text size={200} weight="semibold" style={{ display: "block", margin: "8px 0 4px" }}>
                  {t("admin.officeAdmins.admins")}
                </Text>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {a.adminUpns.length === 0 && (
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      {t("common.none")}
                    </Text>
                  )}
                  {a.adminUpns.map((upn) => (
                    <div
                      key={upn}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "6px 0",
                        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                      }}
                    >
                      <Text font="monospace">{upn}</Text>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        disabled={busyOffice === a.office}
                        onClick={() => removeAdmin(a.office, a.adminUpns, upn)}
                      />
                    </div>
                  ))}
                </div>

                <Field label={t("admin.officeAdmins.addAdmin")} style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Input
                      style={{ flex: 1 }}
                      placeholder="name@englobecorp.com"
                      value={inputs[a.office] ?? ""}
                      onChange={(_, d) => setInputs((i) => ({ ...i, [a.office]: d.value }))}
                      onKeyDown={(e) => e.key === "Enter" && addAdmin(a.office, a.adminUpns)}
                    />
                    <Button appearance="primary" disabled={busyOffice === a.office} onClick={() => addAdmin(a.office, a.adminUpns)}>
                      {t("admin.officeAdmins.addAdmin")}
                    </Button>
                  </div>
                </Field>

                {errors[a.office] && (
                  <MessageBar intent="error" style={{ marginTop: 8 }}>
                    <MessageBarBody>{errors[a.office]}</MessageBarBody>
                  </MessageBar>
                )}
                {savedOffice === a.office && !errors[a.office] && (
                  <Text size={200} style={{ display: "block", marginTop: 8, color: tokens.colorPaletteGreenForeground1 }}>
                    {t("admin.officeAdmins.saved")}
                  </Text>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
