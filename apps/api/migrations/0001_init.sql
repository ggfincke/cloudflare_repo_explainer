CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  workflow_id TEXT,
  repo_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  branch TEXT NOT NULL,
  subdir TEXT,
  commit_sha TEXT,
  status TEXT NOT NULL,
  status_step TEXT NOT NULL,
  status_message TEXT NOT NULL,
  partial_index INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  indexed_files INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  overview_json TEXT,
  memory_summary TEXT NOT NULL DEFAULT '',
  focus_areas_json TEXT NOT NULL DEFAULT '[]',
  last_referenced_files_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_client_updated_at
ON sessions (client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha TEXT,
  content_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, path)
);

CREATE INDEX IF NOT EXISTS idx_files_session_path
ON files (session_id, path);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  heading TEXT,
  symbol TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  token_estimate INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_session_path
ON chunks (session_id, path);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  session_id UNINDEXED,
  path,
  heading,
  symbol,
  text
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  evidence_used_json TEXT NOT NULL DEFAULT '[]',
  suggested_files_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created_at
ON messages (session_id, created_at ASC);
