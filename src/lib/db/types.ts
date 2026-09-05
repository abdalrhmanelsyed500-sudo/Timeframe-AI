import type { ColumnType, Generated } from "kysely";

type Ts = ColumnType<Date, Date | string | undefined, Date | string | undefined>;
type Json<T> = ColumnType<T, T | string, T | string>;

export interface UsersTable {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Generated<string>;
  settings: Generated<Json<Record<string, unknown>>>;
  created_at: Generated<Ts>;
}

export interface ProjectsTable {
  id: string;
  user_id: string;
  name: string;
  description: Generated<string>;
  status: Generated<string>;
  style_key: Generated<string>;
  quality_preset: Generated<string>;
  aspect_ratio: Generated<string>;
  width: Generated<number>;
  height: Generated<number>;
  fps: Generated<number>;
  archived: Generated<boolean>;
  created_at: Generated<Ts>;
  updated_at: Ts;
}

export interface AudiosTable {
  id: string;
  project_id: string;
  storage_key: string;
  filename: string;
  mime: string;
  bytes: number | string;
  duration_ms: number;
  sample_rate: number | null;
  channels: number | null;
  codec: string | null;
  content_hash: string;
  created_at: Generated<Ts>;
}

export interface TranscriptsTable {
  id: string;
  project_id: string;
  source: string;
  language: Generated<string>;
  content_hash: string;
  created_at: Generated<Ts>;
  updated_at: Ts;
}

export interface TranscriptSegmentsTable {
  id: string;
  transcript_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface StoryPlansTable {
  id: string;
  project_id: string;
  version: number;
  status: Generated<string>;
  stale: Generated<boolean>;
  input_hash: string;
  content_hash: string;
  provider: string;
  model: string;
  prompt_version: string;
  summary: Generated<string>;
  created_at: Generated<Ts>;
}

export interface SectionsTable {
  id: string;
  story_plan_id: string;
  idx: number;
  title: string;
  purpose: Generated<string>;
  start_ms: number;
  end_ms: number;
}

export interface ScenesTable {
  id: string;
  section_id: string;
  idx: number;
  title: string;
  purpose: Generated<string>;
  location: Generated<string>;
  era: Generated<string>;
  tone: Generated<string>;
  pacing: Generated<string>;
  visual_strategy: Generated<string>;
  start_ms: number;
  end_ms: number;
}

export interface ShotsTable {
  id: string;
  scene_id: string;
  project_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  narration_text: Generated<string>;
  visual_intent: string;
  subject: Generated<string>;
  action: Generated<string>;
  environment: Generated<string>;
  composition: Generated<string>;
  camera: Generated<string>;
  lens: Generated<string>;
  lighting: Generated<string>;
  color: Generated<string>;
  atmosphere: Generated<string>;
  entity_names: Json<string[]>;
  transition: Generated<string>;
  motion: Generated<string>;
}

export interface VisualBiblesTable {
  id: string;
  project_id: string;
  story_plan_id: string;
  version: number;
  stale: Generated<boolean>;
  content: Json<Record<string, unknown>>;
  content_hash: string;
  provider: string;
  model: string;
  prompt_version: string;
  created_at: Generated<Ts>;
}

export interface EntitiesTable {
  id: string;
  project_id: string;
  visual_bible_id: string | null;
  type: string;
  name: string;
  description: Generated<string>;
  appearance: Generated<string>;
  visual_attrs: Json<Record<string, unknown>>;
  continuity: Json<Record<string, unknown>>;
}

export interface VisualSpecsTable {
  id: string;
  project_id: string;
  shot_id: string;
  spec: Json<Record<string, unknown>>;
  canonical_prompt: string;
  negative_prompt: Generated<string>;
  prompt_version: string;
  content_hash: string;
  created_at: Generated<Ts>;
}

export interface AssetsTable {
  id: string;
  project_id: string;
  shot_id: string;
  kind: Generated<string>;
  status: Generated<string>;
  selected_version_id: string | null;
  attempts: Generated<number>;
  created_at: Generated<Ts>;
}

export interface AssetVersionsTable {
  id: string;
  asset_id: string;
  version: number;
  storage_key: string;
  thumb_key: string | null;
  mime: string;
  width: number;
  height: number;
  bytes: number | string;
  content_hash: string;
  provider: string;
  model: string;
  is_mock: Generated<boolean>;
  prompt: string;
  prompt_version: string;
  qc_gate: string | null;
  qc_score: number | null;
  qc_report: Json<Record<string, unknown>> | null;
  created_at: Generated<Ts>;
}

export interface TimelinesTable {
  id: string;
  project_id: string;
  version: number;
  status: Generated<string>;
  stale: Generated<boolean>;
  duration_ms: number;
  clips: Json<unknown[]>;
  overlays: Json<unknown[]>;
  content_hash: string;
  parent_version: number | null;
  created_at: Generated<Ts>;
}

export interface TimelineDraftsTable {
  project_id: string;
  base_version: number;
  clips: Json<unknown[]>;
  overlays: Json<unknown[]>;
  revision: Generated<number>;
  updated_at: Ts;
}

export interface CinematicReportsTable {
  id: string;
  project_id: string;
  timeline_id: string;
  overall_score: number;
  gate: string;
  dimensions: Json<Record<string, number>>;
  created_at: Generated<Ts>;
}

export interface CinematicIssuesTable {
  id: string;
  report_id: string;
  code: string;
  severity: string;
  message: string;
  shot_id: string | null;
  scene_id: string | null;
  fix_safe: Generated<boolean>;
  fix: Json<Record<string, unknown>> | null;
}

export interface CinematicFixesTable {
  id: string;
  report_id: string;
  issue_id: string;
  before_value: Json<unknown>;
  after_value: Json<unknown>;
  reason: string;
  applied_at: Generated<Ts>;
}

export interface RendersTable {
  id: string;
  project_id: string;
  timeline_id: string;
  profile: string;
  status: Generated<string>;
  progress: Generated<number>;
  stage: Generated<string>;
  error_code: string | null;
  error_message: string | null;
  started_at: Ts | null;
  finished_at: Ts | null;
  cancel_requested: Generated<boolean>;
  created_at: Generated<Ts>;
}

export interface RenderArtifactsTable {
  id: string;
  render_id: string;
  storage_key: string;
  mime: string;
  bytes: number | string;
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
  video_codec: string;
  audio_codec: string | null;
  pixel_format: string | null;
  av_sync_ms: Generated<number>;
  content_hash: string;
  status: Generated<string>;
  created_at: Generated<Ts>;
}

export interface JobsTable {
  id: string;
  project_id: string | null;
  user_id: string;
  type: string;
  status: Generated<string>;
  progress: Generated<number>;
  message: Generated<string>;
  total: number | null;
  completed: Generated<number>;
  failed: Generated<number>;
  payload: Json<Record<string, unknown>>;
  result: Json<Record<string, unknown>> | null;
  error_code: string | null;
  error_message: string | null;
  attempts: Generated<number>;
  idempotency_key: string | null;
  cancel_requested: Generated<boolean>;
  created_at: Generated<Ts>;
  started_at: Ts | null;
  finished_at: Ts | null;
  updated_at: Ts;
}

export interface ProviderCredentialsTable {
  id: string;
  user_id: string;
  provider: string;
  label: Generated<string>;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: Generated<number>;
  last_four: string;
  base_url: string | null;
  enabled: Generated<boolean>;
  last_success_at: Ts | null;
  last_failure_at: Ts | null;
  last_error: string | null;
  created_at: Generated<Ts>;
}

export interface CostRecordsTable {
  id: string;
  user_id: string;
  project_id: string | null;
  operation_id: string;
  provider: string;
  model: string;
  operation_type: string;
  units: Generated<number>;
  estimated_cost: string | number;
  recorded_cost: string | number | null;
  currency: Generated<string>;
  basis: Generated<string>;
  status: Generated<string>;
  created_at: Generated<Ts>;
}

export interface StorageObjectsTable {
  key: string;
  user_id: string;
  project_id: string | null;
  category: string;
  bytes: number | string;
  mime: string;
  created_at: Generated<Ts>;
}

export interface ErrorEventsTable {
  id: string;
  user_id: string | null;
  project_id: string | null;
  job_id: string | null;
  request_id: string | null;
  code: string;
  message: string;
  context: Json<Record<string, unknown>>;
  acknowledged: Generated<boolean>;
  created_at: Generated<Ts>;
}

export interface AuditLogsTable {
  id: string;
  user_id: string | null;
  project_id: string | null;
  action: string;
  target_type: Generated<string>;
  target_id: string | null;
  metadata: Json<Record<string, unknown>>;
  created_at: Generated<Ts>;
}

export interface NotificationsTable {
  id: string;
  user_id: string;
  project_id: string | null;
  level: Generated<string>;
  title: string;
  body: Generated<string>;
  read: Generated<boolean>;
  created_at: Generated<Ts>;
}

export interface StylesTable {
  style_key: string;
  version: number;
  name: string;
  description: string;
  config: Json<Record<string, unknown>>;
}

export interface Database {
  users: UsersTable;
  projects: ProjectsTable;
  audios: AudiosTable;
  transcripts: TranscriptsTable;
  transcript_segments: TranscriptSegmentsTable;
  story_plans: StoryPlansTable;
  sections: SectionsTable;
  scenes: ScenesTable;
  shots: ShotsTable;
  visual_bibles: VisualBiblesTable;
  entities: EntitiesTable;
  visual_specs: VisualSpecsTable;
  assets: AssetsTable;
  asset_versions: AssetVersionsTable;
  timelines: TimelinesTable;
  timeline_drafts: TimelineDraftsTable;
  cinematic_reports: CinematicReportsTable;
  cinematic_issues: CinematicIssuesTable;
  cinematic_fixes: CinematicFixesTable;
  renders: RendersTable;
  render_artifacts: RenderArtifactsTable;
  jobs: JobsTable;
  provider_credentials: ProviderCredentialsTable;
  cost_records: CostRecordsTable;
  storage_objects: StorageObjectsTable;
  error_events: ErrorEventsTable;
  audit_logs: AuditLogsTable;
  notifications: NotificationsTable;
  styles: StylesTable;
}
