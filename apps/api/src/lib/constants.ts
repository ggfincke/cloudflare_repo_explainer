import type { AppEnv } from "./types";

export const OVERVIEW_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const DEFAULT_MAX_INDEXED_FILES = 300;
export const DEFAULT_MAX_INDEXED_BYTES = 6 * 1024 * 1024;
export const DEFAULT_MAX_FILE_BYTES = 200 * 1024;

export const TOP_LEVEL_PRIORITY = [
  "readme.md",
  "package.json",
  "pnpm-workspace.yaml",
  "wrangler.jsonc",
  "tsconfig.json",
  "dockerfile",
];

export const PREFERRED_FOLDERS = [
  "src/",
  "app/",
  "server/",
  "packages/",
  "docs/",
  "lib/",
  "api/",
  "db/",
  "database/",
  "prisma/",
  "migrations/",
  "infra/",
];

export const IGNORED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  ".vercel",
  ".cache",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "vendor",
  "tmp",
  "target",
]);

export const IGNORED_FILENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "composer.lock",
  "poetry.lock",
  "cargo.lock",
]);

export const IGNORED_SUFFIXES = [
  ".min.js",
  ".min.css",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp3",
  ".mp4",
  ".mov",
  ".wasm",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".jar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
];

export const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".prisma",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

export const SPECIAL_TEXT_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "procfile",
  "readme",
]);

export const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "compare",
  "data",
  "does",
  "explain",
  "file",
  "files",
  "flow",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "module",
  "of",
  "on",
  "or",
  "read",
  "repo",
  "should",
  "start",
  "the",
  "this",
  "to",
  "what",
  "where",
  "why",
]);

export function readLimits(env: AppEnv) {
  return {
    maxIndexedFiles: parseNumber(env.MAX_INDEXED_FILES, DEFAULT_MAX_INDEXED_FILES),
    maxIndexedBytes: parseNumber(env.MAX_INDEXED_BYTES, DEFAULT_MAX_INDEXED_BYTES),
    maxFileBytes: parseNumber(env.MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
  };
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
