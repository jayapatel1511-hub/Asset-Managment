# `office_admins.csv` is superseded

**Decision, 2026-09-02**: the admin-to-office mapping is derived from the **location table**, not from
a fixed file.

Jay's requirement — *"we need ability to add offices that we need, it can be n numbers"* — makes a
four-row file wrong in a specific and dangerous way: a newly added office would silently receive no
calibration reminders, and nobody would notice until an instrument went out of calibration in the
field.

## What replaces it

Feature 004's `FR-027` fans notifications out to whatever offices exist in the location table at the
moment it runs. `FR-027a` reports an office with no administrator assigned as a **gap**, rather than
skipping it.

Administrator assignment therefore lives with the location, maintained in the app by the System Owner,
and is loaded by no CSV at all.

## The original file

`office_admins.csv` is retained empty for reference only. Do not load it, do not add offices to it,
and do not build a flow that reads it.

See `docs/08-decisions.md` and `specs/004-calibration-management/spec.md`.
