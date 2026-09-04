-- 0006 — one open installation membership per asset.
--
-- `installation_component` is a span table: an asset joins an installation at `start_at` and
-- leaves at `end_at`, with NULL meaning "still there". Nothing in 0001 stopped the same asset
-- from being open in two installations at once — a geophone simultaneously wired into two sites,
-- which is physically impossible and reads as a data error in every report that counts deployed
-- equipment.
--
-- The rule is enforced as a partial unique index rather than an EXCLUDE constraint because the
-- span columns are ISO-8601 TEXT, not `tstzrange` (0001's header: "Dates are ISO-8601 text,
-- exactly the strings the app already exchanges"). A true overlap constraint needs a range type
-- and a btree_gist exclusion, and converting the columns is a schema change that belongs with the
-- canonical `docs/15` model, not with a compatibility baseline. What this index gives instead is
-- the invariant that actually gets violated in practice and the one WS-W2 names: two OPEN spans.
-- Historical spans that overlap are still possible and are left to the data-quality rules in
-- feature 011 — recorded here so the gap is known rather than assumed closed.
--
-- Verified against every dataset before landing: staged (0 components), synthetic demo (3,138),
-- standard (13,246) and large (65,550) each have zero assets with two open spans, and in fact
-- zero overlapping intervals at all. The index refuses nothing that exists today.
CREATE UNIQUE INDEX IF NOT EXISTS instcomp_one_open_per_asset
  ON installation_component (asset) WHERE end_at IS NULL;

-- The same argument applies one level up: an asset can be the primary of only one open
-- installation. `deploymentService` closes the previous span before opening the next, so this
-- index documents and enforces what that code already intends.
CREATE UNIQUE INDEX IF NOT EXISTS installation_one_open_per_primary
  ON installation (primaryasset) WHERE end_at IS NULL;
