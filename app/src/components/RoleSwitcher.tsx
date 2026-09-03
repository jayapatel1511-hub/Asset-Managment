// MOCK-ONLY
// In the real, Dataverse-backed app, role comes from Entra security group membership
// (docs/05-security.md) — nobody picks their own role. This control exists only because this
// build has no tenant to authenticate against, and the acceptance scenarios explicitly require
// showing Field User vs Office Admin behaviour differences (e.g. FR-030's hidden ICCID/phone/
// static IP, admin-only screens). Delete this component when api/dataverse/ goes live.
import { Dropdown, Option, Label } from "@fluentui/react-components";
import { MOCK_DEMO_USERS, getMockCurrentUserKey, setMockCurrentUserKey } from "../api/mock";
import { t } from "../i18n";

export function RoleSwitcher({ onChange }: { onChange: () => void }) {
  const currentKey = getMockCurrentUserKey();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 12px" }}>
      <Label size="small">{t("search.role")}</Label>
      <Dropdown
        size="small"
        selectedOptions={[currentKey]}
        value={MOCK_DEMO_USERS[currentKey].displayName}
        onOptionSelect={(_, data) => {
          setMockCurrentUserKey(data.optionValue as keyof typeof MOCK_DEMO_USERS);
          onChange();
          // Then reload the whole page. `onChange` re-reads the current USER, but every screen
          // already holding a fetched asset keeps the payload it was served — so switching from
          // Office Admin to Field User on a SIM asset left the ICCID on screen and made FR-030
          // look broken in exactly the demo this control exists for. A role change in reality is
          // a new Entra sign-in, so a full reload is the truthful analogue and leaves no screen
          // holding data fetched as somebody else.
          window.location.reload();
        }}
      >
        {Object.entries(MOCK_DEMO_USERS).map(([key, user]) => (
          <Option key={key} value={key}>
            {user.displayName}
          </Option>
        ))}
      </Dropdown>
    </div>
  );
}
