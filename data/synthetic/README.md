# data/synthetic — hand-authored fiction for feature 007

Everything in this directory is **invented**. Nothing here is loaded by the migration pipeline and
nothing here describes the real company: not the people, not the projects, not the sites, not the
dates offices opened. These files exist so that the synthetic fleet generator
(`app/scripts/synthetic/`, spec `specs/007-synthetic-data/spec.md`) has a fixed, reviewable,
committed source for the only parts of a dataset that cannot be derived — names.

| File | What it is | Spec |
|---|---|---|
| `office_activation.json` | The real office list (from `data/reference/locations.csv`) with **invented** activation dates, target fleet shares (taken from the real 2026-09-02 distribution), map centroids and fictional-phone area codes | FR-030, FR-036 |
| `model_windows.json` | Per catalogue model: first/last purchase year, behaviour class, kit family and role, target Active count at scale 1.0 (the real 2026-09-02 count, rounded up ~10%), plus the one catalogue extension (a modem) | FR-031, FR-032 |
| `roster.json` | Fictional technicians, administrators and the three demo identities, with office, role, start and leave dates. **Generated** by `app/scripts/synthetic/authoring/make-roster.ts` from `people_pool.json`; committed so it can be reviewed and so a regeneration is byte-identical | FR-037, FR-039 |
| `people_pool.json` | Given and family names the roster is built from. Checked at generation time against the Staff column of the source registry — no fictional name may match a real one | FR-003 |
| `project_pool.json` | Disciplines with name templates, typical durations and station counts, and fictional client names | FR-040 |
| `site_pool.json` | Fictional street names and landmark templates per region | FR-042 |

Rules for editing:

- Never add a real person, a real client, a real project number or a real site here. The whole
  point of the directory is that it is safe to publish.
- Keep `roster.json` generated. Edit `people_pool.json` or the rules in `make-roster.ts`, then
  regenerate — hand edits will be overwritten.
- Changing any file changes every synthetic dataset generated afterwards. The manifest records a
  hash of this directory so a dataset can be traced to the inputs that produced it.
