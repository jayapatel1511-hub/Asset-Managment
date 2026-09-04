-- 0015 — Data Management first proof: dictionary, quality rules, issue queue, rule-run jobs.
--
-- CLAUDE.md sequence step 6, feature 011 US1, docs/16 §5.1 / §5.5 / §11 / §14.
-- Read-first subset: `data_dictionary_entry`, `data_quality_rule`, `data_quality_issue`,
-- and `data_job` (needed so `QualityRuleRun` is a named job, not a side effect).
-- Write-heavy tables (`data_job_item`, `data_change_request`, `record_redirect`,
-- `retention_policy`, `legal_hold`, `data_source_record`) wait for later 011 phases.
--
-- Does NOT touch `asset.status`, the generated axis columns, or transaction line
-- state columns — those belong to the DC-22 lane.
--
-- Classification labels below are Dev placeholders (`Unapproved:*`). OD-4 is open;
-- nothing here is a production-accepted corporate taxonomy (FR-020 / SC-001).
-- Retention periods beyond the approved indefinite asset/history class are
-- `Unspecified` — FR-069, do not invent.
--
-- No generic PATCH surface is implied by these tables. Writes go through named
-- commands in `server/src/modules/data-management/`.

CREATE TABLE IF NOT EXISTS data_dictionary_entry (
  id                    text PRIMARY KEY,
  entity_name           text NOT NULL,
  field_name            text NOT NULL,
  display_name          text NOT NULL,
  definition            text NOT NULL,
  data_type             text NOT NULL,
  allowed_values        jsonb,
  owner_role            text NOT NULL,
  steward_role          text NOT NULL,
  authority_mode        text NOT NULL CHECK (authority_mode IN (
                          'SystemDerived', 'AMSManaged', 'ExternalAuthoritative', 'ImportedOnce', 'ReferenceOnly'
                        )),
  classification        text NOT NULL,
  read_roles            text[] NOT NULL,
  write_roles           text[] NOT NULL,
  export_roles          text[] NOT NULL,
  offline_cache_allowed boolean NOT NULL,
  retention_class       text NOT NULL,
  quality_rule_ids      text[] NOT NULL DEFAULT ARRAY[]::text[],
  lineage_source        text,
  deprecated_at         timestamptz,
  replaced_by_field     text,
  row_version           integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_name, field_name)
);

CREATE TABLE IF NOT EXISTS data_quality_rule (
  id                  text PRIMARY KEY,
  rule_key            text NOT NULL,
  version             integer NOT NULL,
  domain              text NOT NULL,
  severity            text NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
  owner_user_id       text,
  schedule            text,
  is_active           boolean NOT NULL DEFAULT true,
  implementation_ref  text NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS data_quality_rule_key_current
  ON data_quality_rule (rule_key) WHERE is_active;

CREATE TABLE IF NOT EXISTS data_quality_issue (
  id                      text PRIMARY KEY,
  rule_id                 text NOT NULL REFERENCES data_quality_rule (id),
  rule_version            integer NOT NULL,
  entity_type             text NOT NULL,
  entity_id               text NOT NULL,
  scope_key               text NOT NULL,
  severity                text NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low')),
  status                  text NOT NULL CHECK (status IN (
                            'Open', 'Assigned', 'InProgress', 'Blocked', 'Resolved',
                            'Waived', 'FalsePositive', 'Reopened'
                          )),
  office_location_id      text,
  owner_user_id           text,
  first_detected_at       timestamptz NOT NULL,
  last_detected_at        timestamptz NOT NULL,
  due_at                  timestamptz,
  evidence                jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_note         text,
  waiver_reason           text,
  waiver_approver_user_id text,
  waiver_expires_at       timestamptz,
  verification_type       text CHECK (verification_type IS NULL OR verification_type IN (
                            'RuleReevaluation', 'ManualApproved'
                          )),
  related_job_id          text,
  row_version             integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, entity_type, entity_id, scope_key)
);
CREATE INDEX IF NOT EXISTS data_quality_issue_status_idx ON data_quality_issue (status, severity);
CREATE INDEX IF NOT EXISTS data_quality_issue_office_idx ON data_quality_issue (office_location_id);
CREATE INDEX IF NOT EXISTS data_quality_issue_rule_idx ON data_quality_issue (rule_id, status);

-- One job header per QualityRuleRun (and later import/export/purge). Item-level
-- rows are deferred: a fleet-wide rule run does not need 1,026 item rows to be
-- useful, and FR-037's "no silent disappearance" applies when those rows exist.
CREATE TABLE IF NOT EXISTS data_job (
  id                    text PRIMARY KEY,
  job_type              text NOT NULL CHECK (job_type IN (
                          'Import', 'BulkUpdate', 'Export', 'Reconciliation', 'DuplicateResolution',
                          'ReferenceMerge', 'RetentionPreview', 'Purge', 'QualityRuleRun'
                        )),
  status                text NOT NULL,
  schema_version        text NOT NULL,
  environment           text NOT NULL,
  requested_by          text NOT NULL,
  approved_by           text,
  idempotency_key       text NOT NULL,
  request_hash          text NOT NULL,
  source_name           text,
  source_hash           text,
  request_parameters    jsonb NOT NULL DEFAULT '{}'::jsonb,
  code_version          text NOT NULL,
  reversibility_class   text NOT NULL CHECK (reversibility_class IN (
                          'Reversible', 'Compensatable', 'Irreversible'
                        )),
  dry_run_summary       jsonb,
  result_summary        jsonb,
  started_at            timestamptz,
  completed_at          timestamptz,
  artifact_path         text,
  artifact_expires_at   timestamptz,
  correlation_id        text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requested_by, idempotency_key)
);
