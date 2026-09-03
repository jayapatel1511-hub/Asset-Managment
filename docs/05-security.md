# 05 — Security & environments

> ## 🗄️ LEGACY-POWER-PLATFORM — PARKED 2026-09-03
>
> Describes **Power Platform** environments, solution layering and Dataverse security roles.
>
> The Power Platform is **not** the delivery path: Power Apps Code App publishing, Dataverse as
> system of record, Power Automate flows F1–F5 as state authority and SharePoint as the primary
> certificate store are all parked. The active direction is the Azure web application —
> `README.md`, `CLAUDE.md`, `docs/14-webapp-architecture.md`, `docs/15-postgres-data-model.md`.
>
> Kept because the role model and data-classification intent carry over. Environments, solution layering and Dataverse role mechanics do not — see `docs/14` for identity and `specs/010` for the platform.

---

## Environments
- `Englobe-AMS-Dev` — Sandbox, Canada. Developers + Jay. Solution unmanaged.
- `Englobe-AMS-Prod` — Production, Canada, Managed Environment if available (28-day backups). Solution managed.
- Service account `svc-ams@englobecorp.com`: owns flows and connections; System Owner role; MFA-exempt via conditional access policy scoped to Power Automate (IT ticket).

## Security roles (Dataverse) — create as copies of Basic User, then set

| Table | AMS Field User | AMS Office Admin | AMS System Owner |
|---|---|---|---|
| eng_equipmentmodel | Read (org) | CRU (org) | all |
| eng_location | Read | CRU | all |
| eng_project | Read | CRU | all |
| eng_asset | Read (org) | CRU (org) — **not** status/location/custodian/project/parent (field security profile denies write) | all |
| eng_transaction | Create, Read (org) | Create, Read, Update own (backdate) | all |
| eng_transactionline | Create, Read (org) | Create, Read | all (only role with Update/Delete) |
| eng_assetrelationship | Read | Create/Update (Component only, enforced by app) | all |
| eng_calibrationrecord | Read | CRU | all |
| eng_idsequence | — | — | all (flows/app mint via svc account or plug-in-free API call with impersonation) |

Field security profile `AMS Sensitive`: `eng_asset.eng_phonenumber`, `eng_staticip`, `eng_identifiervalue`
(ICCID) — read for Office Admin+, hidden for Field User.

Role assignment via Entra security groups: `SG-AMS-FieldUsers`, `SG-AMS-OfficeAdmins`, `SG-AMS-Owners`.

> **Corrected 2026-09-02.** This previously read `SG-AMS-OfficeAdmins-{Ottawa|Toronto|Sudbury|SWO}` —
> a **fixed four-group list**, which contradicts the N-offices decision of the same date. Under that
> decision an eleventh office can be created in the app by an administrator; with per-office groups
> its admins would silently get no rights and no calibration reminders until somebody hand-created a
> group, and nobody would notice until an instrument went out of calibration in the field. This is the
> same defect that superseded `data/reference/office_admins.csv`.
>
> **Use one `SG-AMS-OfficeAdmins` group.** Which offices a given admin administers is data in the
> location table, not group membership — consistent with feature 001's FR-011c, which requires every
> per-office behaviour to be derived from the location table as it stands. Feature 004's FR-027 fans
> notifications out to whatever offices exist; FR-027a reports an office with no administrator as a
> gap rather than skipping it.
>
> If per-office Entra groups are later required for a reason outside this system, group creation must
> become a mandatory step of the office-creation procedure, and that procedure must be written down.
Office-scoped admin filtering is done in the app by home office, not by Dataverse business units (keep it simple).

## App registration
Code App registered in the solution; share with `SG-AMS-FieldUsers` and admins groups. Managers get Power BI only.

## Data handling
- No credentials in any table. `Login`/`Password` columns from the old registry are dropped at export.
- Auditing on for eng_asset, eng_assetrelationship, eng_calibrationrecord.
- Certificates in SharePoint inherit site permissions; library `AMS Documents` readable by all AMS groups.
