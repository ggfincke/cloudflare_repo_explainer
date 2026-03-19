import { makeId } from "./utils";
import type { ChunkRecord, ExtractedRepoFile, FileRecord } from "./types";

const CODE_BOUNDARY = /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const)\s+([A-Za-z0-9_]+)/;
const MARKDOWN_BOUNDARY = /^#{1,4}\s+(.+)/;

export function buildFileRecord(sessionId: string, file: ExtractedRepoFile, createdAt: string): FileRecord {
  return {
    id: makeId("file"),
    sessionId,
    path: file.path,
    language: file.language,
    sizeBytes: file.size,
    sha: file.sha,
    contentText: file.text,
    createdAt,
  };
}

export function chunkFile(sessionId: string, fileRecord: FileRecord, file: ExtractedRepoFile): ChunkRecord[] {
  if (file.language === "Markdown") {
    return chunkMarkdown(sessionId, fileRecord, file);
  }

  if (["TypeScript", "JavaScript", "Python", "Go", "Rust", "Ruby", "Java"].includes(file.language)) {
    return chunkCode(sessionId, fileRecord, file);
  }

  return chunkByLines(sessionId, fileRecord, file, 100, 10);
}

function chunkMarkdown(sessionId: string, fileRecord: FileRecord, file: ExtractedRepoFile) {
  const lines = file.text.split("\n");
  const chunks: ChunkRecord[] = [];
  let startIndex = 0;
  let heading: string | null = null;

  for (let index = 0; index <= lines.length; index += 1) {
    const match = index < lines.length ? MARKDOWN_BOUNDARY.exec(lines[index]) : null;
    const boundary = Boolean(match) && index !== 0;
    const atEnd = index === lines.length;

    if (!boundary && !atEnd) {
      continue;
    }

    const text = lines.slice(startIndex, index).join("\n").trim();
    if (text) {
      chunks.push(buildChunk(sessionId, fileRecord, file, text, startIndex + 1, index, heading, heading));
    }

    startIndex = index;
    heading = match?.[1] ?? null;
  }

  return ensureChunks(chunks, () => chunkByLines(sessionId, fileRecord, file, 120, 12));
}

function chunkCode(sessionId: string, fileRecord: FileRecord, file: ExtractedRepoFile) {
  const lines = file.text.split("\n");
  const boundaries = [0];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }
    if (CODE_BOUNDARY.test(line)) {
      boundaries.push(index);
    }
  }

  boundaries.push(lines.length);

  const chunks: ChunkRecord[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end - start > 140) {
      chunks.push(...chunkLineWindow(sessionId, fileRecord, file, start, end, 120, 15));
      continue;
    }

    const text = lines.slice(start, end).join("\n").trim();
    if (!text) {
      continue;
    }

    const symbolMatch = CODE_BOUNDARY.exec(lines[start]);
    const symbol = symbolMatch?.[4] ?? null;
    chunks.push(buildChunk(sessionId, fileRecord, file, text, start + 1, end, symbol, symbol));
  }

  return ensureChunks(chunks, () => chunkByLines(sessionId, fileRecord, file, 120, 12));
}

function chunkByLines(
  sessionId: string,
  fileRecord: FileRecord,
  file: ExtractedRepoFile,
  chunkSize: number,
  overlap: number,
) {
  return chunkLineWindow(sessionId, fileRecord, file, 0, file.text.split("\n").length, chunkSize, overlap);
}

function chunkLineWindow(
  sessionId: string,
  fileRecord: FileRecord,
  file: ExtractedRepoFile,
  start: number,
  end: number,
  chunkSize: number,
  overlap: number,
) {
  const lines = file.text.split("\n");
  const chunks: ChunkRecord[] = [];

  for (let cursor = start; cursor < end; cursor += chunkSize - overlap) {
    const chunkEnd = Math.min(end, cursor + chunkSize);
    const text = lines.slice(cursor, chunkEnd).join("\n").trim();
    if (!text) {
      continue;
    }

    chunks.push(buildChunk(sessionId, fileRecord, file, text, cursor + 1, chunkEnd, null, null));
    if (chunkEnd === end) {
      break;
    }
  }

  return chunks;
}

function buildChunk(
  sessionId: string,
  fileRecord: FileRecord,
  file: ExtractedRepoFile,
  text: string,
  startLine: number,
  endLine: number,
  heading: string | null,
  symbol: string | null,
): ChunkRecord {
  return {
    id: makeId("chunk"),
    sessionId,
    fileId: fileRecord.id,
    path: file.path,
    language: file.language,
    heading,
    symbol,
    startLine,
    endLine,
    tokenEstimate: Math.ceil(text.length / 4),
    text,
  };
}

function ensureChunks(chunks: ChunkRecord[], fallback: () => ChunkRecord[]) {
  return chunks.length > 0 ? chunks : fallback();
}
