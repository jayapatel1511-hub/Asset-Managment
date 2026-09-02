# 07 — Open questions (need Jay, not a guess)

Blocking Step 1–2:

1. **SWO.** Is SWO an office (assets physically at one place) or a region containing London / Kitchener / Waterloo /
   Stoney Creek? 113 rows say "SWO", 155 say one of the four towns. Proposed: Region *SWO* → Offices *London, Kitchener,
   Waterloo, Stoney Creek*; the 113 "SWO" rows get homeoffice = **London** unless told otherwise. Confirm or correct.
2. **Mississauga / Thunder Bay.** Mississauga (22 rows) under Toronto? Thunder Bay (3 rows) under Sudbury, Ottawa, or its own?
3. **"Deployed or NOT Available" (644 rows).** Migrate as *CheckedOut* with custodian = null (we don't know who/where),
   or as *Available* and let the first real transaction fix it? Proposed: CheckedOut, and the Ottawa pilot includes
   a one-week "return everything you're not holding" sweep.
4. **Equipment model catalogue.** `data/reference/equipment_models_draft.csv` has 65 rows straight from the data, including
   the mislabels. Please correct in place (especially: Larson Davis 831C tagged as `DST-LD`; Instantel "Series IV"
   as manufacturer; Sigicom V12 listed as Data Logger 4×). Add default calibration interval per model (12 months for
   Instantel/Sigicom sensors and loggers? SLMs?).

Before Step 4:

5. **Microphone components.** Does an SLM (S50 / 831C) travel as one asset, or do pre-amp and element get their own
   Asset IDs (they are calibrated separately)? Proposed: own IDs, attached as *Component* children.
6. **Servers (16 × "Azure" / THOR / Vision / INFRANet).** Are these really trackable assets, or configuration? Proposed:
   keep as assets, type Server, non-serialised, never checked out — only referenced as Kit role *Server* on a Deploy.
7. **SIMs.** Is a SIM ever moved between modems, or does it live in one modem permanently? Decides whether it is a
   *Component* child of the modem (permanent) or a *Kit* member (per deployment).
8. **Expected return.** Required on checkout, or optional? Drives F4 overdue notifications.
9. **Backdating.** Can Office Admins record a transaction with a past date (e.g. entering last week's return)? Proposed yes,
   Office Admin only, max 30 days back.

Before Step 6:

10. **Project master.** Is there a system (ERP / Deltek / Vision) we can export active project numbers from, or do we
    seed from the ~80 distinct IDs in the registry and let admins add?
11. **Who gets Power BI Pro?** List of managers/PMs who need reports.

Later:

12. French labels — needed for Ontario users, or only if the system expands to Quebec?
13. Retention: keep Retired assets and their history forever (recommended) or archive after N years?
