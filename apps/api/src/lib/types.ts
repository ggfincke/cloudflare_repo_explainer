import type { Citation, RepoOverview, SessionDetail, SessionStatus, StatusStep } from "@repo-explainer/shared";

export interface AiBinding {
  run(model: string, input: unknown): Promise<{ response?: string } | string>;
}

export interface AppEnv {
  AI: AiBinding;
  DB: D1Database;
  SESSION_COORDINATOR: DurableObjectNamespace;
  INDEX_WORKFLOW: Workflow<WorkflowPayload>;
  ALLOWED_ORIGIN?: string;
  MAX_INDEXED_FILES?: string;
  MAX_INDEXED_BYTES?: string;
  MAX_FILE_BYTES?: string;
  GITHUB_TOKEN?: string;
}

export interface WorkflowPayload {
  sessionId: string;
  repoUrl: string;
  branch?: string;
  subdir?: string;
}

export interface GitHubRepoInput {
  repoUrl: string;
  branch?: string;
  subdir?: string;
}

export interface SelectedRepoFile {
  path: string;
  sha: string;
  size: number;
  language: string;
  priority: number;
}

export interface GitHubRepoPlan {
  repoUrl: string;
  owner: string;
  repoName: string;
  branch: string;
  subdir: string | null;
  commitSha: string;
  description: string | null;
  defaultBranch: string;
  totalFiles: number;
  selectedFiles: SelectedRepoFile[];
  partialIndex: boolean;
}

export interface ExtractedRepoFile extends SelectedRepoFile {
  text: string;
}

export interface ChunkRecord {
  id: string;
  sessionId: string;
  fileId: string;
  path: string;
  language: string;
  heading: string | null;
  symbol: string | null;
  startLine: number;
  endLine: number;
  tokenEstimate: number;
  text: string;
}

export interface FileRecord {
  id: string;
  sessionId: string;
  path: string;
  language: string;
  sizeBytes: number;
  sha: string;
  contentText: string;
  createdAt: string;
}

export interface RetrievedChunk {
  id: string;
  path: string;
  language: string;
  text: string;
  startLine: number;
  endLine: number;
  heading: string | null;
  symbol: string | null;
  score: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  suggestedFiles: string[];
  weakEvidence: boolean;
}

export interface SessionSnapshot {
  id: string;
  status: SessionStatus;
  statusStep: StatusStep;
  statusMessage: string;
  memorySummary: string;
  focusAreas: string[];
  lastReferencedFiles: string[];
}

export interface SessionSummaryRow {
  id: string;
  client_id: string;
  workflow_id: string | null;
  repo_url: string;
  repo_name: string;
  repo_owner: string;
  branch: string;
  subdir: string | null;
  commit_sha: string | null;
  status: SessionStatus;
  status_step: StatusStep;
  status_message: string;
  partial_index: number;
  total_files: number;
  indexed_files: number;
  total_bytes: number;
  overview_json: string | null;
  memory_summary: string;
  focus_areas_json: string;
  last_referenced_files_json: string;
  created_at: string;
  updated_at: string;
}

export interface ChatAnswerResult {
  answer: string;
  citations: Citation[];
  evidenceUsed: Citation[];
  suggestedFiles: string[];
  weakEvidence: boolean;
}

export interface OverviewSeed {
  overview: RepoOverview;
  summaryContext: string;
}

export interface SessionStatusPatch {
  status?: SessionStatus;
  statusStep?: StatusStep;
  statusMessage?: string;
  branch?: string;
  workflowId?: string | null;
  commitSha?: string | null;
  totalFiles?: number;
  indexedFiles?: number;
  totalBytes?: number;
  partialIndex?: boolean;
  overview?: RepoOverview | null;
}

export interface RetryResetOptions {
  workflowId: string;
  branch?: string;
  subdir?: string;
}

export interface SessionContext {
  session: SessionDetail;
  snapshot: SessionSnapshot;
}
