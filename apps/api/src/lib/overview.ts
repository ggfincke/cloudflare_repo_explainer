import type { RepoOverview } from "@repo-explainer/shared";

import { OVERVIEW_MODEL } from "./constants";
import { getOverviewChunks, listFilesForOverview } from "./db";
import type { AppEnv, OverviewSeed } from "./types";
import { compact, trimToLength, uniqueStrings } from "./utils";

export async function generateOverview(env: AppEnv, sessionId: string, repoDescription: string | null) {
  const files = await listFilesForOverview(env.DB, sessionId);
  const importantFolders = inferImportantFolders(files.map((file) => file.path));
  const entrypoints = inferEntrypoints(files.map((file) => file.path));
  const readingOrder = inferReadingOrder(files.map((file) => file.path), entrypoints.map((entry) => entry.path));
  const technologies = inferTechnologies(files.map((file) => file.path));

  const seedPaths = uniqueStrings(
    compact<string>([
      "README.md",
      ...entrypoints.slice(0, 3).map((item) => item.path),
      ...readingOrder.slice(0, 3).map((item) => item.path),
    ]),
  );
  const chunks = await getOverviewChunks(env.DB, sessionId, seedPaths);
  const evidence = chunks
    .slice(0, 8)
    .map((chunk) => `[${chunk.path}:${chunk.startLine}-${chunk.endLine}]\n${trimToLength(chunk.text, 1200)}`)
    .join("\n\n");

  const prompt = [
    "You are summarizing a source code repository for a new engineer.",
    "Only use the provided evidence. If something is uncertain, say likely or inferred.",
    "Write one tight paragraph that explains what the project appears to do, its architecture shape, and how to start reading it.",
    repoDescription ? `Repository description: ${repoDescription}` : null,
    `Technologies detected: ${technologies.join(", ") || "Unknown"}`,
    `Important folders: ${importantFolders.map((item) => item.path).join(", ") || "Unknown"}`,
    `Likely entrypoints: ${entrypoints.map((item) => item.path).join(", ") || "Unknown"}`,
    "Evidence:",
    evidence || "No textual evidence found.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const summary = await runSummaryModel(env, prompt);

  const overview: RepoOverview = {
    summary,
    technologies,
    importantFolders,
    entrypoints,
    readingOrder,
    notes: [],
  };

  return {
    overview,
    summaryContext: prompt,
  } satisfies OverviewSeed;
}

function inferTechnologies(paths: string[]) {
  const found = new Set<string>();
  const lowerPaths = paths.map((path) => path.toLowerCase());

  if (lowerPaths.some((path) => path.endsWith("package.json"))) found.add("Node.js");
  if (lowerPaths.some((path) => path.endsWith(".ts") || path.endsWith(".tsx"))) found.add("TypeScript");
  if (lowerPaths.some((path) => path.endsWith(".js") || path.endsWith(".jsx"))) found.add("JavaScript");
  if (lowerPaths.some((path) => path.includes("wrangler"))) found.add("Cloudflare Workers");
  if (lowerPaths.some((path) => path.includes("vite"))) found.add("Vite");
  if (lowerPaths.some((path) => path.endsWith(".py") || path.endsWith("pyproject.toml"))) found.add("Python");
  if (lowerPaths.some((path) => path.endsWith(".sql") || path.includes("prisma"))) found.add("Database layer");
  if (lowerPaths.some((path) => path.endsWith("dockerfile"))) found.add("Docker");

  return [...found].slice(0, 6);
}

function inferImportantFolders(paths: string[]) {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const top = path.split("/")[0];
    if (!top || !path.includes("/")) {
      continue;
    }
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([path, count]) => ({
      path,
      reason: folderReason(path, count),
    }));
}

function folderReason(path: string, count: number) {
  const lower = path.toLowerCase();
  if (lower === "src") return "Primary application source.";
  if (lower === "app") return "Likely app routes or UI shell.";
  if (lower === "server" || lower === "api") return "Server-side or API entry layer.";
  if (lower === "packages") return "Workspace packages split by responsibility.";
  if (lower === "docs") return "Project documentation and onboarding material.";
  if (lower.includes("db") || lower.includes("prisma") || lower.includes("migration")) return "Database schemas and data changes.";
  return `${count} indexed files in this folder.`;
}

function inferEntrypoints(paths: string[]) {
  const candidates = [
    "README.md",
    "src/index.ts",
    "src/main.tsx",
    "src/main.ts",
    "src/server.ts",
    "src/app.ts",
    "app/page.tsx",
    "app/layout.tsx",
    "server/index.ts",
    "index.ts",
    "index.js",
    "main.py",
  ];

  return candidates
    .filter((candidate) => paths.includes(candidate))
    .slice(0, 5)
    .map((path) => ({
      path,
      reason: entryReason(path),
    }));
}

function entryReason(path: string) {
  if (path === "README.md") return "Fastest high-level project overview.";
  if (path.includes("main") || path.includes("index")) return "Likely startup or application bootstrap file.";
  if (path.includes("layout") || path.includes("page")) return "Likely top-level UI route shell.";
  return "Likely important entrypoint.";
}

function inferReadingOrder(paths: string[], entrypoints: string[]) {
  const sequence = uniqueStrings([
    "README.md",
    "package.json",
    "pnpm-workspace.yaml",
    ...entrypoints,
    ...paths.filter((path) => path.startsWith("src/")).slice(0, 2),
    ...paths.filter((path) => path.startsWith("docs/")).slice(0, 1),
  ]);

  return sequence.slice(0, 6).map((path) => ({
    path,
    reason: path === "README.md" ? "Start with the project overview." : "Useful next stop when onboarding.",
  }));
}

async function runSummaryModel(env: AppEnv, prompt: string) {
  try {
    const response = await env.AI.run(OVERVIEW_MODEL, {
      prompt,
      temperature: 0.1,
      max_tokens: 350,
    });
    if (typeof response === "string") {
      return response.trim();
    }
    return response.response?.trim() ?? "Overview generation succeeded, but no summary text was returned.";
  } catch {
    return "This repository was indexed successfully. Review the detected entrypoints and suggested reading order to start navigating the codebase.";
  }
}
