# 05 — Security & environments

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

Role assignment via Entra security groups: `SG-AMS-FieldUsers`, `SG-AMS-OfficeAdmins-{Ottawa|Toronto|Sudbury|SWO}`, `SG-AMS-Owners`.
Office-scoped admin filtering is done in the app by home office, not by Dataverse business units (keep it simple).

## App registration
Code App registered in the solution; share with `SG-AMS-FieldUsers` and admins groups. Managers get Power BI only.

## Data handling
- No credentials in any table. `Login`/`Password` columns from the old registry are dropped at export.
- Auditing on for eng_asset, eng_assetrelationship, eng_calibrationrecord.
- Certificates in SharePoint inherit site permissions; library `AMS Documents` readable by all AMS groups.
