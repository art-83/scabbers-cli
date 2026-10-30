import { it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { Publication } from "../src/development/publication.js";
import { configSchema } from "../src/config/types/config.js";
it("publishes changed repositories only and reconciles a lost MR response without another commit or MR", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-publication-"));
  const origin = join(directory, "origin.git"),
    repo = join(directory, "repository");
  mkdirSync(repo);
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  git(["init", "--bare", origin], directory);
  git(["init", "-b", "master"]);
  git(["config", "user.email", "local-test@example.test"]);
  git(["config", "user.name", "Local Test"]);
  writeFileSync(join(repo, "source.ts"), "export const value=1;\n");
  git(["add", "."]);
  git(["commit", "-m", "baseline"]);
  const base = git(["rev-parse", "HEAD"]);
  git(["remote", "add", "origin", origin]);
  git(["push", "origin", "master"]);
  git(["branch", "staging"]);
  git(["push", "origin", "staging"]);
  const store = new Store(join(directory, "state.db"));
  const run = store.create("development", "NOLA-LOCAL", "codex", "profile", {});
  const reference = join(directory, "reference");
  git(["clone", origin, reference], directory);
  git(["checkout", "-b", `codex/scabbers-${run.id}`], reference);
  git(["checkout", "-b", `codex/scabbers-${run.id}`]);
  writeFileSync(join(repo, "source.ts"), "export const value=2;\n");
  run.data = {
    workspaces: { "arcca-pdv": repo, "arccanet-frontend": reference },
    form: { proposed_fix: { files: ["arcca-pdv/source.ts"] } },
  };
  store.save(run);
  const config = configSchema.parse({
    gitlab: { baseUrl: "https://gitlab.example.test", projectId: "123" },
    repositories: [
      {
        name: "arcca-pdv",
        path: repo,
        stagingUrl: "https://staging.example.test",
        testCommand: ["node", "--test"],
        gitlabProjectId: "123",
      },
      { name: "arccanet-frontend", path: reference, gitlabProjectId: "456" },
    ],
  });
  const publication = new Publication(store, config, directory);
  let created = false;
  let posts = 0;
  vi.stubEnv("SCABBERS_GITLAB_TOKEN", "test-only-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options: any) => {
      if (options.method === "POST") {
        created = true;
        posts++;
        throw new Error("response lost after server created MR");
      }
      if (String(url).includes("/merge_requests?"))
        return new Response(
          JSON.stringify(
            created
              ? [{ iid: 1, description: `scabbers:${run.id}:arcca-pdv:draft` }]
              : [],
          ),
        );
      throw new Error("Unexpected URL");
    }),
  );
  try {
    const preview = await publication.preview(run);
    run.data.publicationApproval = preview.digest;
    run.data.finalTestDigest = preview.digest;
    store.save(run);
    await expect(publication.publish(run)).rejects.toThrow("response lost");
    const committed = git(["rev-parse", "HEAD"]);
    expect(committed).not.toBe(base);
    const recovered = store.get(run.id);
    const result = await publication.publish(recovered);
    expect(result["arcca-pdv"]).toMatchObject({ mergeRequest: { iid: 1 } });
    expect(result["arccanet-frontend"]).toBeUndefined();
    expect(
      (store.get(run.id).data.publicationProgress as any)["arccanet-frontend"],
    ).toBeUndefined();
    expect(git(["rev-parse", "HEAD"], reference)).toBe(base);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([url]) => !String(url).includes("/456/")),
    ).toBe(true);
    expect(posts).toBe(1);
    expect(git(["rev-parse", "HEAD"])).toBe(committed);
    expect(git(["rev-parse", "master"], origin)).toBe(base);
    expect(
      git(["merge-base", "--is-ancestor", committed, "staging"], origin),
    ).toBe("");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
