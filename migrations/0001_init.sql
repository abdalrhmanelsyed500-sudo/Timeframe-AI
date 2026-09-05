-- TIMEFRAME AI :: initial schema
-- All timeline values are integer milliseconds. No floats for authoritative time.

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'USER',
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'CREATED',
  style_key       TEXT NOT NULL DEFAULT 'cinematic_documentary',
  quality_preset  TEXT NOT NULL DEFAULT 'BALANCED',
  aspect_ratio    TEXT NOT NULL DEFAULT '16:9',
  width           INTEGER NOT NULL DEFAULT 1920,
  height          INTEGER NOT NULL DEFAULT 1080,
  fps             INTEGER NOT NULL DEFAULT 30,
  archived        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON projects(user_id, created_at DESC);

CREATE TABLE audios (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  storage_key     TEXT NOT NULL,
  filename        TEXT NOT NULL,
  mime            TEXT NOT NULL,
  bytes           BIGINT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  sample_rate     INTEGER,
  channels        INTEGER,
  codec           TEXT,
  content_hash    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcripts (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'en',
  content_hash    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcript_segments (
  id              TEXT PRIMARY KEY,
  transcript_id   TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  start_ms        INTEGER NOT NULL,
  end_ms          INTEGER NOT NULL,
  text            TEXT NOT NULL,
  UNIQUE (transcript_id, idx),
  CHECK (start_ms >= 0 AND end_ms > start_ms)
);
CREATE INDEX segments_transcript_idx ON transcript_segments(transcript_id, start_ms);

CREATE TABLE story_plans (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT',
  stale           BOOLEAN NOT NULL DEFAULT false,
  input_hash      TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE TABLE sections (
  id              TEXT PRIMARY KEY,
  story_plan_id   TEXT NOT NULL REFERENCES story_plans(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  title           TEXT NOT NULL,
  purpose         TEXT NOT NULL DEFAULT '',
  start_ms        INTEGER NOT NULL,
  end_ms          INTEGER NOT NULL,
  UNIQUE (story_plan_id, idx)
);

CREATE TABLE scenes (
  id              TEXT PRIMARY KEY,
  section_id      TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  title           TEXT NOT NULL,
  purpose         TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  era             TEXT NOT NULL DEFAULT '',
  tone            TEXT NOT NULL DEFAULT 'NEUTRAL',
  pacing          TEXT NOT NULL DEFAULT 'MEDIUM',
  visual_strategy TEXT NOT NULL DEFAULT '',
  start_ms        INTEGER NOT NULL,
  end_ms          INTEGER NOT NULL,
  UNIQUE (section_id, idx)
);

CREATE TABLE shots (
  id              TEXT PRIMARY KEY,
  scene_id        TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  start_ms        INTEGER NOT NULL,
  end_ms          INTEGER NOT NULL,
  narration_text  TEXT NOT NULL DEFAULT '',
  visual_intent   TEXT NOT NULL,
  subject         TEXT NOT NULL DEFAULT '',
  action          TEXT NOT NULL DEFAULT '',
  environment     TEXT NOT NULL DEFAULT '',
  composition     TEXT NOT NULL DEFAULT '',
  camera          TEXT NOT NULL DEFAULT 'STATIC',
  lens            TEXT NOT NULL DEFAULT '35mm',
  lighting        TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT '',
  atmosphere      TEXT NOT NULL DEFAULT '',
  entity_names    JSONB NOT NULL DEFAULT '[]'::jsonb,
  transition      TEXT NOT NULL DEFAULT 'CUT',
  motion          TEXT NOT NULL DEFAULT 'STATIC',
  UNIQUE (scene_id, idx),
  CHECK (start_ms >= 0 AND end_ms > start_ms)
);
CREATE INDEX shots_project_idx ON shots(project_id, start_ms);

CREATE TABLE visual_bibles (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_plan_id   TEXT NOT NULL REFERENCES story_plans(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  stale           BOOLEAN NOT NULL DEFAULT false,
  content         JSONB NOT NULL,
  content_hash    TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE TABLE entities (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  visual_bible_id TEXT REFERENCES visual_bibles(id) ON DELETE SET NULL,
  type            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  appearance      TEXT NOT NULL DEFAULT '',
  visual_attrs    JSONB NOT NULL DEFAULT '{}'::jsonb,
  continuity      JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (project_id, name)
);

CREATE TABLE visual_specs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id         TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  spec            JSONB NOT NULL,
  canonical_prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  prompt_version  TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shot_id)
);

CREATE TABLE assets (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shot_id              TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL DEFAULT 'IMAGE',
  status               TEXT NOT NULL DEFAULT 'PENDING',
  selected_version_id  TEXT,
  attempts             INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shot_id, kind)
);
CREATE INDEX assets_project_idx ON assets(project_id, status);

CREATE TABLE asset_versions (
  id              TEXT PRIMARY KEY,
  asset_id        TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  storage_key     TEXT NOT NULL,
  thumb_key       TEXT,
  mime            TEXT NOT NULL,
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  bytes           BIGINT NOT NULL,
  content_hash    TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  is_mock         BOOLEAN NOT NULL DEFAULT false,
  prompt          TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  qc_gate         TEXT,
  qc_score        REAL,
  qc_report       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, version)
);

ALTER TABLE assets ADD CONSTRAINT assets_selected_version_fk
  FOREIGN KEY (selected_version_id) REFERENCES asset_versions(id) ON DELETE SET NULL;

CREATE TABLE timelines (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT',
  stale           BOOLEAN NOT NULL DEFAULT false,
  duration_ms     INTEGER NOT NULL,
  clips           JSONB NOT NULL,
  overlays        JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash    TEXT NOT NULL,
  parent_version  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE TABLE timeline_drafts (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  base_version    INTEGER NOT NULL,
  clips           JSONB NOT NULL,
  overlays        JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision        INTEGER NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cinematic_reports (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_id     TEXT NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  overall_score   REAL NOT NULL,
  gate            TEXT NOT NULL,
  dimensions      JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cinematic_issues (
  id              TEXT PRIMARY KEY,
  report_id       TEXT NOT NULL REFERENCES cinematic_reports(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  severity        TEXT NOT NULL,
  message         TEXT NOT NULL,
  shot_id         TEXT,
  scene_id        TEXT,
  fix_safe        BOOLEAN NOT NULL DEFAULT false,
  fix             JSONB
);

CREATE TABLE cinematic_fixes (
  id              TEXT PRIMARY KEY,
  report_id       TEXT NOT NULL REFERENCES cinematic_reports(id) ON DELETE CASCADE,
  issue_id        TEXT NOT NULL,
  before_value    JSONB NOT NULL,
  after_value     JSONB NOT NULL,
  reason          TEXT NOT NULL,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE renders (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timeline_id     TEXT NOT NULL REFERENCES timelines(id) ON DELETE RESTRICT,
  profile         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'QUEUED',
  progress        REAL NOT NULL DEFAULT 0,
  stage           TEXT NOT NULL DEFAULT 'QUEUED',
  error_code      TEXT,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX renders_project_idx ON renders(project_id, created_at DESC);

CREATE TABLE render_artifacts (
  id              TEXT PRIMARY KEY,
  render_id       TEXT NOT NULL UNIQUE REFERENCES renders(id) ON DELETE CASCADE,
  storage_key     TEXT NOT NULL,
  mime            TEXT NOT NULL,
  bytes           BIGINT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  fps             REAL NOT NULL,
  video_codec     TEXT NOT NULL,
  audio_codec     TEXT,
  pixel_format    TEXT,
  av_sync_ms      INTEGER NOT NULL DEFAULT 0,
  content_hash    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'VALID',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'QUEUED',
  progress        REAL NOT NULL DEFAULT 0,
  message         TEXT NOT NULL DEFAULT '',
  total           INTEGER,
  completed       INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  result          JSONB,
  error_code      TEXT,
  error_message   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_idempotency_idx ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX jobs_project_idx ON jobs(project_id, created_at DESC);

CREATE TABLE provider_credentials (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  ciphertext      TEXT NOT NULL,
  iv              TEXT NOT NULL,
  auth_tag        TEXT NOT NULL,
  key_version     INTEGER NOT NULL DEFAULT 1,
  last_four       TEXT NOT NULL,
  base_url        TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE cost_records (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  operation_id    TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  operation_type  TEXT NOT NULL,
  units           INTEGER NOT NULL DEFAULT 1,
  estimated_cost  NUMERIC(12,6) NOT NULL DEFAULT 0,
  recorded_cost   NUMERIC(12,6),
  currency        TEXT NOT NULL DEFAULT 'USD',
  basis           TEXT NOT NULL DEFAULT 'ESTIMATED',
  status          TEXT NOT NULL DEFAULT 'OK',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cost_user_idx ON cost_records(user_id, created_at DESC);

CREATE TABLE storage_objects (
  key             TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  bytes           BIGINT NOT NULL,
  mime            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX storage_user_idx ON storage_objects(user_id);

CREATE TABLE error_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  job_id          TEXT,
  request_id      TEXT,
  code            TEXT NOT NULL,
  message         TEXT NOT NULL,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX error_user_idx ON error_events(user_id, created_at DESC);

CREATE TABLE audit_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id      TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT NOT NULL DEFAULT '',
  target_id       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_project_idx ON audit_logs(project_id, created_at DESC);

CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
  level           TEXT NOT NULL DEFAULT 'INFO',
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  read            BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notif_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE styles (
  style_key       TEXT NOT NULL,
  version         INTEGER NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  config          JSONB NOT NULL,
  PRIMARY KEY (style_key, version)
);
