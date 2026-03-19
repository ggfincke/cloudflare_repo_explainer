import type { Citation } from "@repo-explainer/shared";

import { STOP_WORDS } from "./constants";

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
}

export function errorResponse(message: string, status = 400) {
  return json({ error: message }, { status });
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeSubdir(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/^\/+|\/+$/g, "");
  return normalized || undefined;
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function withCors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function preflight(origin: string) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
  });
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function compact<T>(values: Array<T | null | undefined | false>) {
  return values.filter(Boolean) as T[];
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function formatCitation(citation: Citation) {
  if (citation.startLine && citation.endLine) {
    return `${citation.path}:${citation.startLine}-${citation.endLine}`;
  }
  return citation.path;
}

export function scoreWeakEvidence(citations: Citation[]) {
  return citations.length < 2;
}

export function extractKeywords(input: string) {
  return uniqueStrings(
    input
      .toLowerCase()
      .match(/[a-z0-9_.:/-]{2,}/g)
      ?.filter((token) => !STOP_WORDS.has(token) && !token.startsWith("http")) ?? [],
  );
}

export function extractFocusAreas(message: string, filePaths: string[]) {
  const keywords = extractKeywords(message).slice(0, 6);
  const pathTopics = filePaths
    .flatMap((path) => path.split("/"))
    .map((segment) => segment.replace(/\.[a-z0-9]+$/i, ""))
    .filter((segment) => segment.length > 2)
    .slice(0, 6);
  return uniqueStrings([...keywords, ...pathTopics]).slice(0, 8);
}

export function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
}

export function isLikelyText(value: string) {
  return !value.includes("\u0000");
}

export function trimToLength(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function escapeLike(value: string) {
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function sanitizeFtsToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:/-]/g, "");
}

export function buildFtsQuery(parts: string[]) {
  const tokens = parts.map(sanitizeFtsToken).filter((token) => token.length > 1);
  return tokens.map((token) => `"${token}" OR ${token}*`).join(" OR ");
}
