// MOCK-ONLY
// In the real, Dataverse-backed app, role comes from Entra security group membership
// (docs/05-security.md) — nobody picks their own role. This control exists only because this
// build has no tenant to authenticate against, and the acceptance scenarios explicitly require
// showing Field User vs Office Admin behaviour differences (e.g. FR-030's hidden ICCID/phone/
// static IP, admin-only screens). Delete this component when api/dataverse/ goes live.
import { MOCK_DEMO_USERS, getMockCurrentUserKey, setMockCurrentUserKey } from "../api/mock";
import { Chip } from "./Chip";
import { t } from "../i18n";

const LABELS: Record<keyof typeof MOCK_DEMO_USERS, "role.field" | "role.admin" | "role.owner" | "role.reader"> = {
  field: "role.field",
  admin: "role.admin",
  owner: "role.owner",
  reader: "role.reader",
};

export function RoleSwitcher({ onChange }: { onChange: () => void }) {
  const currentKey = getMockCurrentUserKey();
  return (
    <div className="ams-chips" role="group" aria-label={t("search.role")}>
      {(Object.keys(MOCK_DEMO_USERS) as Array<keyof typeof MOCK_DEMO_USERS>).map((key) => {
        const on = key === currentKey;
        return (
          <Chip
            key={key}
            on={on}
            onClick={() => {
              if (key === currentKey) return;
              setMockCurrentUserKey(key);
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
            {t(LABELS[key])}
          </Chip>
        );
      })}
    </div>
  );
}
