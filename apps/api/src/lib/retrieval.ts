import type { Citation } from "@repo-explainer/shared";

import { buildFtsQuery, compact, extractKeywords, scoreWeakEvidence, uniqueStrings } from "./utils";
import type { AppEnv, RetrievalResult, RetrievedChunk, SessionSnapshot } from "./types";
import { getChunksForPaths, searchChunks, searchChunksByLike } from "./db";

export async function retrieveEvidence(
  env: AppEnv,
  sessionId: string,
  question: string,
  snapshot: SessionSnapshot,
): Promise<RetrievalResult> {
  const explicitPaths = detectExplicitPaths(question, snapshot.lastReferencedFiles);
  const directChunks = await getChunksForPaths(env.DB, sessionId, explicitPaths, 4);

  const keywords = uniqueStrings([
    ...extractKeywords(question),
    ...snapshot.focusAreas.map((item) => item.toLowerCase()),
    ...explicitPaths.flatMap((path) => path.split("/").map((segment) => segment.toLowerCase())),
  ]).slice(0, 8);

  const ftsQuery = buildFtsQuery(keywords);
  const searchedChunks = ftsQuery
    ? await searchChunks(env.DB, sessionId, ftsQuery, 10).catch(() => [])
    : [];
  const fallbackChunks = directChunks.length >= 4 ? [] : await searchChunksByLike(env.DB, sessionId, keywords, 8);

  const chunks = mergeChunks([...directChunks, ...searchedChunks, ...fallbackChunks]);
  const citations = buildCitations(chunks.slice(0, 4));
  const suggestedFiles = uniqueStrings(chunks.slice(0, 4).map((chunk) => chunk.path));

  return {
    chunks: chunks.slice(0, 8),
    citations,
    suggestedFiles,
    weakEvidence: scoreWeakEvidence(citations),
  };
}

export function detectExplicitPaths(question: string, lastReferencedFiles: string[]) {
  const backtickMatches = [...question.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const pathMatches = question.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
  const explicit = uniqueStrings([...backtickMatches, ...pathMatches]).slice(0, 2);

  if (explicit.length >= 2) {
    return explicit;
  }

  if (/\b(compare|earlier|that file|that service)\b/i.test(question) && lastReferencedFiles.length > 0) {
    return uniqueStrings([...explicit, ...lastReferencedFiles]).slice(0, 2);
  }

  return explicit;
}

function buildCitations(chunks: RetrievedChunk[]): Citation[] {
  return uniqueByPathAndRange(
    chunks.map((chunk) => ({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      reason: compact([chunk.heading ?? chunk.symbol ?? null, chunk.language]).join(" · "),
    })),
  );
}

function mergeChunks(chunks: RetrievedChunk[]) {
  const seen = new Set<string>();
  const deduped: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    if (seen.has(chunk.id)) {
      continue;
    }
    seen.add(chunk.id);
    deduped.push(chunk);
  }

  return deduped.sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    return left.path.localeCompare(right.path);
  });
}

function uniqueByPathAndRange(citations: Citation[]) {
  const seen = new Set<string>();
  const deduped: Citation[] = [];
  for (const citation of citations) {
    const key = `${citation.path}:${citation.startLine ?? 0}:${citation.endLine ?? 0}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(citation);
  }
  return deduped;
}
