import { describe, expect, it } from "vitest";

import { parseGitHubRepoUrl } from "./github";

describe("parseGitHubRepoUrl", () => {
  it("extracts owner and repo from a standard github url", () => {
    expect(parseGitHubRepoUrl("https://github.com/cloudflare/workers-sdk")).toEqual({
      owner: "cloudflare",
      repoName: "workers-sdk",
    });
  });

  it("rejects non github hosts", () => {
    expect(() => parseGitHubRepoUrl("https://gitlab.com/cloudflare/workers-sdk")).toThrow(
      /Only github.com/,
    );
  });
});
