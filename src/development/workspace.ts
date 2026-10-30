import { join, resolve, relative, isAbsolute } from "node:path";
import { lstatSync } from "node:fs";
import { ProcessRunner } from "../runtime/process-runner.js";
import { ScopePolicy } from "./scope-policy.js";
export class Workspace {
  constructor(
    private readonly directory: string,
    private readonly runner = new ProcessRunner(),
  ) {}
  async prepareAnalysis(
    runId: string,
    repositories: { name: string; path: string; baseBranch?: string }[],
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    // The configured repositories are web projects; task eligibility is checked separately.
    new ScopePolicy().assert(
      repositories.map((r) => r.name),
      ["web"],
    );
    const paths: Record<string, string> = {};
    for (const repo of repositories) {
      const target = join(this.directory, "worktrees", runId, repo.name);
      const git = async (args: string[]) =>
        this.runner.run("git", args, repo.path, "", undefined, signal, 60000);
      const check = await git(["worktree", "list", "--porcelain"]);
      if (check.code) throw new Error("Cannot inspect repository worktrees");
      if (!check.stdout.includes(`worktree ${target}\n`)) {
        const branch = repo.baseBranch ?? "master";
        const ref = `refs/heads/${branch}`;
        if ((await git(["check-ref-format", ref])).code)
          throw new Error(`Invalid base branch for ${repo.name}`);
        const remoteRef = `refs/remotes/origin/${branch}`;
        const fetched = await git([
          "fetch",
          "--no-tags",
          "--no-recurse-submodules",
          "origin",
          `${ref}:${remoteRef}`,
        ]);
        if (fetched.code)
          throw new Error(
            `Cannot fetch origin/${branch} for ${repo.name}; fresh task preparation blocked`,
          );
        const revision = await git([
          "rev-parse",
          "--verify",
          `${remoteRef}^{commit}`,
        ]);
        if (revision.code || !/^[a-f0-9]{40,64}$/.test(revision.stdout.trim()))
          throw new Error(`Cannot verify fetched base for ${repo.name}`);
        const created = await git([
          "worktree",
          "add",
          "--detach",
          target,
          revision.stdout.trim(),
        ]);
        if (created.code)
          throw new Error(
            "Cannot create isolated analysis worktree; existing state is preserved",
          );
      }
      paths[repo.name] = target;
    }
    return paths;
  }
  async revisions(
    paths: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    const revisions: Record<string, string> = {};
    for (const [name, path] of Object.entries(paths)) {
      const result = await this.runner.run(
        "git",
        ["rev-parse", "--verify", "HEAD^{commit}"],
        path,
        "",
        undefined,
        signal,
      );
      if (result.code || !/^[a-f0-9]{40,64}$/.test(result.stdout.trim()))
        throw new Error("Cannot verify pinned workspace revision");
      revisions[name] = result.stdout.trim();
    }
    return revisions;
  }
  async prepare(
    runId: string,
    repositories: { name: string; path: string; baseBranch?: string }[],
    products: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    new ScopePolicy().assert(
      repositories.map((r) => r.name),
      products,
    );
    const paths = await this.prepareAnalysis(runId, repositories, signal);
    const expected = `codex/scabbers-${runId}`;
    for (const path of Object.values(paths)) {
      const branch = await this.runner.run(
        "git",
        ["branch", "--show-current"],
        path,
        "",
        undefined,
        signal,
      );
      if (branch.code) throw new Error("Cannot verify task worktree branch");
      if (branch.stdout.trim() === expected) continue;
      if (branch.stdout.trim())
        throw new Error(
          "Existing worktree has an unexpected branch; preserved for inspection",
        );
      const status = await this.runner.run(
        "git",
        ["status", "--porcelain"],
        path,
        "",
        undefined,
        signal,
      );
      if (status.code || status.stdout.trim())
        throw new Error(
          "Analysis worktree changed before eligibility; inspect preserved files",
        );
      const created = await this.runner.run(
        "git",
        ["switch", "-c", expected],
        path,
        "",
        undefined,
        signal,
      );
      if (created.code)
        throw new Error(
          "Cannot create task branch; existing worktree is preserved",
        );
    }
    return paths;
  }
  validatePlan(paths: Record<string, string>, files: string[]): void {
    if (!files.length) throw new Error("A bounded file plan is required");
    for (const file of files) {
      const [repository, ...parts] = file.split("/");
      const root = paths[repository!];
      const path = parts.join("/");
      if (
        !root ||
        !path ||
        isAbsolute(path) ||
        path.split("/").some((x) => x === ".." || x === ".git") ||
        /(^|\/)(?:AGENTS\.md|CLAUDE\.md|\.env[^/]*|\.gitlab-ci\.yml|package-lock\.json)$/.test(
          path,
        )
      )
        throw new Error("File plan outside authorized source scope");
      let current = root;
      for (const part of parts) {
        current = resolve(current, part);
        try {
          if (lstatSync(current).isSymbolicLink())
            throw new Error("Symlinks in edit plan require human review");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (relative(root, resolve(root, path)).startsWith(".."))
        throw new Error("Path escaped worktree");
    }
  }
  async changed(paths: Record<string, string>): Promise<string[]> {
    const files: string[] = [];
    for (const [name, path] of Object.entries(paths)) {
      const r = await this.runner.run(
        "git",
        ["status", "--porcelain", "-uall"],
        path,
      );
      if (r.code) throw new Error("Cannot verify changed files");
      for (const line of r.stdout.split("\n").filter(Boolean)) {
        if (line.includes(" -> "))
          throw new Error("Renames need an explicit plan review");
        files.push(name + "/" + line.slice(3).replace(/^"|"$/g, ""));
      }
    }
    return files;
  }
}
