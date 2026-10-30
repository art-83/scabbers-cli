import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "../src/development/workspace.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scabbers-fresh-base-"));
  const upstream = join(root, "upstream");
  const remote = join(root, "origin.git");
  const local = join(root, "local");
  mkdirSync(upstream);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(upstream, "init", "-b", "master");
  git(upstream, "config", "user.name", "Local fixture");
  git(upstream, "config", "user.email", "fixture@example.test");
  writeFileSync(join(upstream, "source.txt"), "initial\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "initial");
  git(root, "init", "--bare", remote);
  git(upstream, "remote", "add", "origin", remote);
  git(upstream, "push", "origin", "master");
  git(root, "clone", remote, local);
  const advance = (text: string) => {
    writeFileSync(join(upstream, "source.txt"), text);
    git(upstream, "commit", "-am", "upstream change");
    git(upstream, "push", "origin", "master");
    return git(upstream, "rev-parse", "HEAD");
  };
  return { root, upstream, remote, local, git, advance };
}

it("fetches the fresh remote before analysis, preserves dirty user files and pins that revision through task branch creation and retries", async () => {
  const f = fixture();
  try {
    const oldHead = f.git(f.local, "rev-parse", "HEAD");
    f.git(f.local, "switch", "-c", "user-work");
    writeFileSync(join(f.local, "source.txt"), "unsaved user work\n");
    writeFileSync(join(f.local, "untracked.txt"), "keep me\n");
    const fresh = f.advance("fresh remote code\n");
    const workspace = new Workspace(join(f.root, "state"));
    const repos = [{ name: "arcca-pdv", path: f.local, baseBranch: "master" }];
    const analysis = await workspace.prepareAnalysis("fixture", repos);
    const path = analysis["arcca-pdv"]!;
    expect(f.git(path, "rev-parse", "HEAD")).toBe(fresh);
    expect(f.git(path, "branch", "--show-current")).toBe("");
    expect(readFileSync(join(path, "source.txt"), "utf8")).toBe(
      "fresh remote code\n",
    );
    expect(f.git(f.local, "rev-parse", "HEAD")).toBe(oldHead);
    expect(f.git(f.local, "branch", "--show-current")).toBe("user-work");
    expect(readFileSync(join(f.local, "source.txt"), "utf8")).toBe(
      "unsaved user work\n",
    );
    expect(readFileSync(join(f.local, "untracked.txt"), "utf8")).toBe(
      "keep me\n",
    );
    const newer = f.advance("later upstream code\n");
    expect(await workspace.prepareAnalysis("fixture", repos)).toEqual(analysis);
    const task = await workspace.prepare("fixture", repos, ["web"]);
    expect(task).toEqual(analysis);
    expect(f.git(path, "branch", "--show-current")).toBe(
      "codex/scabbers-fixture",
    );
    expect((await workspace.revisions(task))["arcca-pdv"]).toBe(fresh);
    const next = await workspace.prepareAnalysis("next", repos);
    expect((await workspace.revisions(next))["arcca-pdv"]).toBe(newer);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("supports an explicit main base and blocks fresh tasks on fetch errors instead of reusing cached refs", async () => {
  const f = fixture();
  try {
    f.git(f.upstream, "branch", "main");
    f.git(f.upstream, "push", "origin", "main");
    const workspace = new Workspace(join(f.root, "state"));
    const repos = [{ name: "arcca-pdv", path: f.local, baseBranch: "main" }];
    const paths = await workspace.prepareAnalysis("valid", repos);
    expect((await workspace.revisions(paths))["arcca-pdv"]).toBe(
      f.git(f.upstream, "rev-parse", "main"),
    );
    f.git(
      f.local,
      "remote",
      "set-url",
      "origin",
      join(f.root, "missing-remote.git"),
    );
    await expect(workspace.prepareAnalysis("blocked", repos)).rejects.toThrow(
      "Cannot fetch origin/main",
    );
    expect(existsSync(join(f.root, "state/worktrees/blocked/arcca-pdv"))).toBe(
      false,
    );
    // A previously prepared checkpoint remains resumable without refreshing its base.
    expect(await workspace.prepareAnalysis("valid", repos)).toEqual(paths);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
