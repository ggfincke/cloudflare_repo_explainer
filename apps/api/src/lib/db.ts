import type {
  ChatMessage,
  Citation,
  RepoOverview,
  SessionDetail,
  SessionListItem,
} from "@repo-explainer/shared";

import type {
  ChunkRecord,
  FileRecord,
  RetrievedChunk,
  SessionStatusPatch,
  SessionSummaryRow,
} from "./types";
import { compact, nowIso, safeJsonParse } from "./utils";

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations_json: string;
  evidence_used_json: string;
  suggested_files_json: string;
  created_at: string;
}

interface RetrievedChunkRow {
  id: string;
  path: string;
  language: string;
  text: string;
  start_line: number;
  end_line: number;
  heading: string | null;
  symbol: string | null;
  score?: number;
}

interface FileOverviewRow {
  path: string;
  language: string;
  size_bytes: number;
}

export async function insertSession(
  db: D1Database,
  input: {
    id: string;
    clientId: string;
    workflowId: string;
    repoUrl: string;
    repoName: string;
    repoOwner: string;
    branch: string;
    subdir: string | null;
  },
) {
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO sessions (
        id, client_id, workflow_id, repo_url, repo_name, repo_owner, branch, subdir,
        status, status_step, status_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', 'Queued for indexing', ?, ?)`,
    )
    .bind(
      input.id,
      input.clientId,
      input.workflowId,
      input.repoUrl,
      input.repoName,
      input.repoOwner,
      input.branch,
      input.subdir,
      timestamp,
      timestamp,
    )
    .run();
}

export async function getSessionDetail(db: D1Database, sessionId: string) {
  const result = await db
    .prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1")
    .bind(sessionId)
    .first<SessionSummaryRow>();

  return result ? mapSessionRow(result) : null;
}

export async function getSessionRow(db: D1Database, sessionId: string) {
  const result = await db
    .prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1")
    .bind(sessionId)
    .first<SessionSummaryRow>();
  return result ?? null;
}

export async function listSessionsByClientId(db: D1Database, clientId: string) {
  const result = await db
    .prepare("SELECT * FROM sessions WHERE client_id = ? ORDER BY updated_at DESC LIMIT 20")
    .bind(clientId)
    .all<SessionSummaryRow>();

  return (result.results ?? []).map(mapSessionListItem);
}

export async function listMessages(db: D1Database, sessionId: string): Promise<ChatMessage[]> {
  const result = await db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
    .bind(sessionId)
    .all<MessageRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    citations: safeJsonParse<Citation[]>(row.citations_json, []),
    evidenceUsed: safeJsonParse<Citation[]>(row.evidence_used_json, []),
    suggestedFiles: safeJsonParse<string[]>(row.suggested_files_json, []),
    createdAt: row.created_at,
  }));
}

export async function updateSession(db: D1Database, sessionId: string, patch: SessionStatusPatch) {
  const updates = compact<string>([
    patch.status ? "status = ?" : null,
    patch.statusStep ? "status_step = ?" : null,
    patch.statusMessage ? "status_message = ?" : null,
    patch.branch !== undefined ? "branch = ?" : null,
    patch.workflowId !== undefined ? "workflow_id = ?" : null,
    patch.commitSha !== undefined ? "commit_sha = ?" : null,
    patch.totalFiles !== undefined ? "total_files = ?" : null,
    patch.indexedFiles !== undefined ? "indexed_files = ?" : null,
    patch.totalBytes !== undefined ? "total_bytes = ?" : null,
    patch.partialIndex !== undefined ? "partial_index = ?" : null,
    patch.overview !== undefined ? "overview_json = ?" : null,
    "updated_at = ?",
  ]);

  const values = compact<unknown>([
    patch.status,
    patch.statusStep,
    patch.statusMessage,
    patch.branch,
    patch.workflowId,
    patch.commitSha,
    patch.totalFiles,
    patch.indexedFiles,
    patch.totalBytes,
    patch.partialIndex === undefined ? undefined : patch.partialIndex ? 1 : 0,
    patch.overview === undefined ? undefined : JSON.stringify(patch.overview),
    nowIso(),
  ]);

  await db
    .prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, sessionId)
    .run();
}

export async function updateMemoryState(
  db: D1Database,
  sessionId: string,
  input: { memorySummary: string; focusAreas: string[]; lastReferencedFiles: string[] },
) {
  await db
    .prepare(
      `UPDATE sessions
       SET memory_summary = ?, focus_areas_json = ?, last_referenced_files_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.memorySummary,
      JSON.stringify(input.focusAreas),
      JSON.stringify(input.lastReferencedFiles),
      nowIso(),
      sessionId,
    )
    .run();
}

export async function persistFilesAndChunks(
  db: D1Database,
  input: Array<{ file: FileRecord; chunks: ChunkRecord[] }>,
) {
  const statements: D1PreparedStatement[] = [];
  for (const item of input) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO files
           (id, session_id, path, language, size_bytes, sha, content_text, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          item.file.id,
          item.file.sessionId,
          item.file.path,
          item.file.language,
          item.file.sizeBytes,
          item.file.sha,
          item.file.contentText,
          item.file.createdAt,
        ),
    );

    for (const chunk of item.chunks) {
      statements.push(
        db
          .prepare(
            `INSERT INTO chunks
             (id, session_id, file_id, path, language, heading, symbol, start_line, end_line, token_estimate, text)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            chunk.id,
            chunk.sessionId,
            chunk.fileId,
            chunk.path,
            chunk.language,
            chunk.heading,
            chunk.symbol,
            chunk.startLine,
            chunk.endLine,
            chunk.tokenEstimate,
            chunk.text,
          ),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO chunks_fts (chunk_id, session_id, path, heading, symbol, text)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(chunk.id, chunk.sessionId, chunk.path, chunk.heading, chunk.symbol, chunk.text),
      );
    }
  }

  if (statements.length === 0) {
    return;
  }

  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

export async function resetSessionIndexData(db: D1Database, sessionId: string) {
  await db.batch([
    db.prepare("DELETE FROM chunks_fts WHERE session_id = ?").bind(sessionId),
    db.prepare("DELETE FROM chunks WHERE session_id = ?").bind(sessionId),
    db.prepare("DELETE FROM files WHERE session_id = ?").bind(sessionId),
  ]);

  await db
    .prepare(
      `UPDATE sessions
       SET commit_sha = NULL,
           total_files = 0,
           indexed_files = 0,
           total_bytes = 0,
           partial_index = 0,
           overview_json = NULL,
           status = 'queued',
           status_step = 'queued',
           status_message = 'Queued for indexing',
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(nowIso(), sessionId)
    .run();
}

export async function insertMessage(
  db: D1Database,
  input: {
    id: string;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    citations?: Citation[];
    evidenceUsed?: Citation[];
    suggestedFiles?: string[];
    createdAt: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO messages
       (id, session_id, role, content, citations_json, evidence_used_json, suggested_files_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.sessionId,
      input.role,
      input.content,
      JSON.stringify(input.citations ?? []),
      JSON.stringify(input.evidenceUsed ?? []),
      JSON.stringify(input.suggestedFiles ?? []),
      input.createdAt,
    )
    .run();
}

export async function searchChunks(db: D1Database, sessionId: string, ftsQuery: string, limit: number) {
  const result = await db
    .prepare(
      `SELECT chunks.id, chunks.path, chunks.language, chunks.text, chunks.start_line, chunks.end_line, chunks.heading, chunks.symbol,
              bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks ON chunks.id = chunks_fts.chunk_id
       WHERE chunks_fts MATCH ? AND chunks.session_id = ?
       ORDER BY score
       LIMIT ?`,
    )
    .bind(ftsQuery, sessionId, limit)
    .all<RetrievedChunkRow>();

  return (result.results ?? []).map(mapRetrievedChunk);
}

export async function searchChunksByLike(db: D1Database, sessionId: string, terms: string[], limit: number) {
  if (terms.length === 0) {
    return [];
  }

  const clauses = terms.map(() => "(LOWER(path) LIKE ? OR LOWER(text) LIKE ?)");
  const binds = terms.flatMap((term) => [`%${term.toLowerCase()}%`, `%${term.toLowerCase()}%`]);
  const result = await db
    .prepare(
      `SELECT id, path, language, text, start_line, end_line, heading, symbol, 1000 AS score
       FROM chunks
       WHERE session_id = ? AND (${clauses.join(" OR ")})
       LIMIT ?`,
    )
    .bind(sessionId, ...binds, limit)
    .all<RetrievedChunkRow>();

  return (result.results ?? []).map(mapRetrievedChunk);
}

export async function getChunksForPaths(db: D1Database, sessionId: string, paths: string[], limitPerPath = 4) {
  const uniquePaths = [...new Set(paths)].filter(Boolean);
  const results: RetrievedChunk[] = [];

  for (const path of uniquePaths) {
    const result = await db
      .prepare(
        `SELECT id, path, language, text, start_line, end_line, heading, symbol, 0 AS score
         FROM chunks
         WHERE session_id = ? AND (path = ? OR path LIKE ?)
         ORDER BY start_line ASC
         LIMIT ?`,
      )
      .bind(sessionId, path, `%${path}`, limitPerPath)
      .all<RetrievedChunkRow>();
    results.push(...(result.results ?? []).map(mapRetrievedChunk));
  }

  return results;
}

export async function listFilesForOverview(db: D1Database, sessionId: string) {
  const result = await db
    .prepare(
      `SELECT path, language, size_bytes
       FROM files
       WHERE session_id = ?
       ORDER BY path ASC`,
    )
    .bind(sessionId)
    .all<FileOverviewRow>();

  return result.results ?? [];
}

export async function getOverviewChunks(db: D1Database, sessionId: string, paths: string[]) {
  return getChunksForPaths(db, sessionId, paths, 2);
}

function mapSessionRow(row: SessionSummaryRow): SessionDetail {
  return {
    id: row.id,
    repoUrl: row.repo_url,
    repoName: `${row.repo_owner}/${row.repo_name}`,
    branch: row.branch,
    subdir: row.subdir,
    status: row.status,
    statusStep: row.status_step,
    statusMessage: row.status_message,
    updatedAt: row.updated_at,
    partialIndex: Boolean(row.partial_index),
    workflowId: row.workflow_id,
    commitSha: row.commit_sha,
    totalFiles: row.total_files,
    indexedFiles: row.indexed_files,
    totalBytes: row.total_bytes,
    memorySummary: row.memory_summary,
    focusAreas: safeJsonParse<string[]>(row.focus_areas_json, []),
    lastReferencedFiles: safeJsonParse<string[]>(row.last_referenced_files_json, []),
    overview: safeJsonParse<RepoOverview | null>(row.overview_json, null),
  };
}

function mapSessionListItem(row: SessionSummaryRow): SessionListItem {
  const detail = mapSessionRow(row);
  return {
    id: detail.id,
    repoUrl: detail.repoUrl,
    repoName: detail.repoName,
    branch: detail.branch,
    subdir: detail.subdir,
    status: detail.status,
    statusStep: detail.statusStep,
    statusMessage: detail.statusMessage,
    updatedAt: detail.updatedAt,
    partialIndex: detail.partialIndex,
  };
}

function mapRetrievedChunk(row: RetrievedChunkRow): RetrievedChunk {
  return {
    id: row.id,
    path: row.path,
    language: row.language,
    text: row.text,
    startLine: row.start_line,
    endLine: row.end_line,
    heading: row.heading,
    symbol: row.symbol,
    score: row.score ?? 0,
  };
}
