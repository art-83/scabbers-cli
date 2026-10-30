import type { PublicationPreview } from "./types/publication-preview.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Store } from "../storage/store.js";
import type { Config } from "../config/types/config.js";
import type { Run } from "../workflows/types/run.js";
import { ProcessRunner } from "../runtime/process-runner.js";
import { Effects } from "../runtime/effects.js";
import { GitlabClient } from "../integrations/gitlab/gitlab-client.js";
import { Secrets } from "../integrations/secrets.js";
export class Publication {
  private readonly runner = new ProcessRunner();
  private readonly effects: Effects;
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly directory: string,
  ) {
    this.effects = new Effects(store);
  }
  async preview(run: Run): Promise<PublicationPreview> {
    let diff = "";
    const repositories: PublicationPreview["repositories"] = {};
    for (const [name, path] of Object.entries(
      run.data.workspaces as Record<string, string>,
    )) {
      const planned = (
        run.data.form as { proposed_fix: { files: string[] } }
      ).proposed_fix.files
        .filter((f) => f.startsWith(name + "/"))
        .map((f) => f.slice(name.length + 1));
      const staged = await this.runner.run(
        "git",
        ["add", "--", ...planned],
        path,
      );
      if (staged.code)
        throw new Error("Cannot stage approved file plan for review");
      const result = await this.runner.run("git", ["diff", "HEAD", "--"], path);
      const untracked = await this.runner.run(
        "git",
        ["ls-files", "--others", "--exclude-standard"],
        path,
      );
      if (result.code || untracked.code)
        throw new Error("Cannot inspect publication diff");
      if (untracked.stdout.trim())
        throw new Error(
          "Stage planned test/source files locally before publication review so their content is included in the digest",
        );
      const head = await this.runner.run("git", ["rev-parse", "HEAD"], path);
      if (head.code) throw new Error("Cannot verify base revision");
      repositories[name] = { head: head.stdout.trim(), diff: result.stdout };
      diff += name + "\n" + head.stdout + result.stdout;
    }
    return {
      digest: createHash("sha256").update(diff).digest("hex"),
      diff,
      repositories,
    };
  }
  async publish(run: Run): Promise<Record<string, unknown>> {
    if (!this.config.gitlab)
      throw new Error("Configure GitLab before publication");
    const progress = (run.data.publicationProgress ?? {}) as Record<
      string,
      { head: string; revision?: string; mergeRequest?: unknown }
    >;
    let preview = run.data.publicationPreview as PublicationPreview | undefined;
    if (!Object.keys(progress).length) {
      preview = await this.preview(run);
      if (
        run.data.publicationApproval !== preview.digest ||
        run.data.finalTestDigest !== preview.digest
      )
        throw new Error(
          "Publication diff differs from reviewed or tested content; repeat final tests and private review",
        );
      run.data.publicationPreview = preview;
      run.data.publicationProgress = progress;
      this.store.save(run);
    }
    if (!preview || run.data.publicationApproval !== preview.digest)
      throw new Error("Missing reviewed publication snapshot");
    const token = await new Secrets(this.config.aws).get(
      "SCABBERS_GITLAB_TOKEN",
    );
    const results: Record<string, unknown> = {};
    for (const [name, path] of Object.entries(
      run.data.workspaces as Record<string, string>,
    )) {
      const repo = this.config.repositories.find((r) => r.name === name)!;
      const projectId =
        repo.gitlabProjectId ??
        (Object.keys(run.data.workspaces as object).length === 1
          ? this.config.gitlab.projectId
          : undefined);
      if (!projectId)
        throw new Error(
          "Configure gitlabProjectId for each repository in a multi-repository delivery",
        );
      const gitlab = new GitlabClient(
        { ...this.config.gitlab, projectId },
        token,
      );
      const branch = `codex/scabbers-${run.id}`;
      const git = async (args: string[], cwd = path) => {
        const result = await this.runner.run("git", args, cwd);
        if (result.code)
          throw new Error(
            "Git checkpoint failed: " +
              args[0] +
              ". Worktrees preserved; inspect conflicts before retry.",
          );
        return result.stdout.trim();
      };
      const current = await git(["branch", "--show-current"]);
      if (current !== branch) throw new Error("Task worktree branch changed");
      const status = await git(["status", "--porcelain"]);
      let head: string;
      if (progress[name]) {
        head = await git(["rev-parse", "HEAD"]);
        if (head !== progress[name]!.head || status)
          throw new Error(
            "Committed task content changed after approval; inspect preserved checkpoint",
          );
      } else {
        const currentDiff = await this.runner.run(
          "git",
          ["diff", "HEAD", "--"],
          path,
        );
        const currentHead = await git(["rev-parse", "HEAD"]);
        if (
          currentDiff.code ||
          currentDiff.stdout !== preview.repositories[name]?.diff ||
          currentHead !== preview.repositories[name]?.head
        )
          throw new Error(
            "Repository changed since concrete publication review",
          );
        if (status) await git(["commit", "-m", `Fix ${run.source}`]);
        head = await git(["rev-parse", "HEAD"]);
        progress[name] = { head };
        run.data.publicationProgress = progress;
        this.store.save(run);
      }
      if (progress[name]!.mergeRequest) {
        results[name] = {
          revision: progress[name]!.revision,
          branch,
          mergeRequest: progress[name]!.mergeRequest,
        };
        continue;
      }
      await git(["push", "origin", `HEAD:refs/heads/${branch}`]);
      const resource = `staging:${projectId}`;
      if (!this.store.acquire(resource, run.id))
        throw new Error(
          "Staging integration busy; resume after other delivery completes",
        );
      try {
        await git(["fetch", "origin", "staging"]);
        const ancestor = await this.runner.run(
          "git",
          ["merge-base", "--is-ancestor", head, "origin/staging"],
          path,
        );
        let revision: string;
        if (ancestor.code === 0)
          revision = await git(["rev-parse", "origin/staging"]);
        else {
          if (ancestor.code !== 1)
            throw new Error("Cannot verify staging ancestry");
          const integration = join(
            this.directory,
            "staging",
            String(projectId),
            run.id,
          );
          const listed = await git(["worktree", "list", "--porcelain"]);
          if (!listed.includes(`worktree ${integration}\n`))
            await git([
              "worktree",
              "add",
              "--detach",
              integration,
              "origin/staging",
            ]);
          await git(
            [
              "merge",
              "--no-ff",
              head,
              "-m",
              `Merge ${run.source} into staging`,
            ],
            integration,
          );
          revision = await git(["rev-parse", "HEAD"], integration);
          await git(["push", "origin", "HEAD:refs/heads/staging"], integration);
        }
        progress[name]!.revision = revision;
        this.store.save(run);
        const marker = `scabbers:${run.id}:${name}:draft`;
        const mr = await this.effects.once(
          run.id,
          marker,
          () => gitlab.findDraft(branch, marker),
          () =>
            gitlab.draft(
              branch,
              run.source,
              `Bounded fix with regression, one independent review and final tests. Human staging validation pending.\n${marker}`,
            ),
        );
        progress[name]!.mergeRequest = mr;
        this.store.save(run);
        results[name] = { revision, branch, mergeRequest: mr };
      } finally {
        this.store.db
          .prepare("DELETE FROM locks WHERE resource=? AND owner=?")
          .run(resource, run.id);
      }
    }
    return results;
  }
}
