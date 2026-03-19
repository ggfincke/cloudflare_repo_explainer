import { describe, expect, it } from "vitest";

import { buildFileRecord, chunkFile } from "./chunking";
import type { ExtractedRepoFile } from "./types";

describe("chunkFile", () => {
  it("creates declaration-aware chunks for code files", () => {
    const file: ExtractedRepoFile = {
      path: "src/example.ts",
      sha: "abc123",
      size: 120,
      language: "TypeScript",
      priority: 5,
      text: [
        "export function alpha() {",
        "  return 1;",
        "}",
        "",
        "export function beta() {",
        "  return 2;",
        "}",
      ].join("\n"),
    };

    const fileRecord = buildFileRecord("session-1", file, "2026-03-18T00:00:00.000Z");
    const chunks = chunkFile("session-1", fileRecord, file);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].path).toBe("src/example.ts");
    expect(chunks[0].startLine).toBe(1);
  });

  it("creates heading-aware chunks for markdown files", () => {
    const file: ExtractedRepoFile = {
      path: "README.md",
      sha: "def456",
      size: 120,
      language: "Markdown",
      priority: 10,
      text: ["# Intro", "", "Hello repo", "", "## Usage", "", "Run the thing"].join("\n"),
    };

    const fileRecord = buildFileRecord("session-1", file, "2026-03-18T00:00:00.000Z");
    const chunks = chunkFile("session-1", fileRecord, file);

    expect(chunks.length).toBe(2);
    expect(chunks[1].heading).toBe("Usage");
  });
});
