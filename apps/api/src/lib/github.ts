import { unzipSync } from "fflate";

import {
  IGNORED_FILENAMES,
  IGNORED_SEGMENTS,
  IGNORED_SUFFIXES,
  PREFERRED_FOLDERS,
  SPECIAL_TEXT_FILENAMES,
  TEXT_EXTENSIONS,
  TOP_LEVEL_PRIORITY,
  readLimits,
} from "./constants";
import type { AppEnv, ExtractedRepoFile, GitHubRepoInput, GitHubRepoPlan, SelectedRepoFile } from "./types";
import { isLikelyText, normalizeLineEndings, normalizeSubdir } from "./utils";

interface GitHubRepoResponse {
  default_branch: string;
  description: string | null;
  name: string;
  owner: {
    login: string;
  };
}

interface GitHubBranchResponse {
  commit: {
    sha: string;
  };
}

interface GitHubTreeResponse {
  truncated: boolean;
  tree: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
  }>;
}

export function parseGitHubRepoUrl(repoUrl: string) {
  const url = new URL(repoUrl);
  if (url.hostname !== "github.com") {
    throw new Error("Only github.com repository URLs are supported in v1.");
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) {
    throw new Error("Repository URL must include an owner and repository name.");
  }

  return {
    owner: parts[0],
    repoName: parts[1].replace(/\.git$/i, ""),
  };
}

export async function buildRepoPlan(env: AppEnv, input: GitHubRepoInput): Promise<GitHubRepoPlan> {
  const { owner, repoName } = parseGitHubRepoUrl(input.repoUrl);
  const subdir = normalizeSubdir(input.subdir);
  const repo = await githubJson<GitHubRepoResponse>(
    env,
    `https://api.github.com/repos/${owner}/${repoName}`,
  );
  const branch = input.branch?.trim() || repo.default_branch;
  const branchData = await githubJson<GitHubBranchResponse>(
    env,
    `https://api.github.com/repos/${owner}/${repoName}/branches/${encodeURIComponent(branch)}`,
  );
  const tree = await githubJson<GitHubTreeResponse>(
    env,
    `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branchData.commit.sha}?recursive=1`,
  );

  const { selectedFiles, partialIndex } = filterTreeEntries(env, tree.tree, subdir);

  return {
    repoUrl: input.repoUrl,
    owner: repo.owner.login,
    repoName: repo.name,
    branch,
    subdir: subdir ?? null,
    commitSha: branchData.commit.sha,
    description: repo.description,
    defaultBranch: repo.default_branch,
    totalFiles: tree.tree.filter((entry) => entry.type === "blob").length,
    selectedFiles,
    partialIndex: tree.truncated || partialIndex,
  };
}

export async function extractSelectedFiles(
  env: AppEnv,
  plan: GitHubRepoPlan,
): Promise<ExtractedRepoFile[]> {
  const archive = await githubFetch(
    env,
    `https://api.github.com/repos/${plan.owner}/${plan.repoName}/zipball/${plan.commitSha}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!archive.ok) {
    throw new Error(`GitHub archive download failed with status ${archive.status}.`);
  }

  const bytes = new Uint8Array(await archive.arrayBuffer());
  const entries = unzipSync(bytes);
  const selectedMap = new Map(plan.selectedFiles.map((file) => [file.path, file]));
  const decodedFiles: ExtractedRepoFile[] = [];

  for (const [archivePath, content] of Object.entries(entries)) {
    const normalizedPath = stripArchivePrefix(archivePath);
    if (!normalizedPath) {
      continue;
    }
    const selectedFile = selectedMap.get(normalizedPath);
    if (!selectedFile) {
      continue;
    }

    const text = normalizeLineEndings(new TextDecoder("utf-8").decode(content));
    if (!isLikelyText(text)) {
      continue;
    }

    decodedFiles.push({
      ...selectedFile,
      text,
    });
  }

  return decodedFiles.sort((left, right) => left.path.localeCompare(right.path));
}

function stripArchivePrefix(archivePath: string) {
  const parts = archivePath.split("/");
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(1).join("/");
}

function filterTreeEntries(
  env: AppEnv,
  tree: GitHubTreeResponse["tree"],
  subdir: string | undefined,
): { selectedFiles: SelectedRepoFile[]; partialIndex: boolean } {
  const limits = readLimits(env);
  const selected: SelectedRepoFile[] = [];
  let totalBytes = 0;

  const blobs = tree
    .filter((entry) => entry.type === "blob" && typeof entry.size === "number")
    .map((entry) => ({
      ...entry,
      size: entry.size ?? 0,
      normalizedPath: normalizeSubdirPrefix(entry.path),
    }))
    .filter((entry) => !subdir || entry.normalizedPath.startsWith(`${subdir}/`) || entry.normalizedPath === subdir)
    .filter((entry) => shouldIncludePath(entry.normalizedPath, entry.size));

  blobs.sort((left, right) => {
    const priorityDelta = priorityForPath(right.normalizedPath) - priorityForPath(left.normalizedPath);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.normalizedPath.localeCompare(right.normalizedPath);
  });

  for (const entry of blobs) {
    if (selected.length >= limits.maxIndexedFiles) {
      break;
    }
    if (totalBytes + entry.size > limits.maxIndexedBytes) {
      break;
    }
    totalBytes += entry.size;
    selected.push({
      path: entry.normalizedPath,
      sha: entry.sha,
      size: entry.size,
      language: guessLanguage(entry.normalizedPath),
      priority: priorityForPath(entry.normalizedPath),
    });
  }

  return {
    selectedFiles: selected,
    partialIndex: selected.length < blobs.length,
  };
}

function normalizeSubdirPrefix(path: string) {
  return path.replace(/^\/+|\/+$/g, "");
}

function shouldIncludePath(path: string, size: number) {
  if (!path || size <= 0) {
    return false;
  }

  if (IGNORED_FILENAMES.has(path.split("/").at(-1)?.toLowerCase() ?? "")) {
    return false;
  }

  if (size > 200 * 1024) {
    return false;
  }

  const lower = path.toLowerCase();
  if (IGNORED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return false;
  }

  const segments = lower.split("/");
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) {
    return false;
  }

  const filename = segments.at(-1) ?? "";
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }

  return SPECIAL_TEXT_FILENAMES.has(filename);
}

function priorityForPath(path: string) {
  const lower = path.toLowerCase();
  if (TOP_LEVEL_PRIORITY.includes(lower)) {
    return 10;
  }
  if (lower === "readme.md") {
    return 12;
  }
  if (PREFERRED_FOLDERS.some((prefix) => lower.startsWith(prefix))) {
    return 8;
  }
  if (lower.split("/").length === 1) {
    return 6;
  }
  return 1;
}

export function guessLanguage(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "TypeScript";
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs")) return "JavaScript";
  if (lower.endsWith(".py")) return "Python";
  if (lower.endsWith(".rs")) return "Rust";
  if (lower.endsWith(".go")) return "Go";
  if (lower.endsWith(".rb")) return "Ruby";
  if (lower.endsWith(".java")) return "Java";
  if (lower.endsWith(".sql")) return "SQL";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "Markdown";
  if (lower.endsWith(".json")) return "JSON";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "YAML";
  if (lower.endsWith(".toml")) return "TOML";
  if (lower.endsWith(".css")) return "CSS";
  if (lower.endsWith(".html")) return "HTML";
  return "Text";
}

async function githubJson<T>(env: AppEnv, url: string): Promise<T> {
  const response = await githubFetch(env, url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${url} with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function githubFetch(env: AppEnv, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", "repo-explainer");
  headers.set("X-GitHub-Api-Version", "2022-11-28");

  if (env.GITHUB_TOKEN) {
    headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  }

  return fetch(url, {
    ...init,
    headers,
    redirect: "follow",
  });
}
