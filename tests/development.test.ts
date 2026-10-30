import { Hierarchy } from "../src/features/hierarchy.js";
import { it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { configSchema } from "../src/config/types/config.js";
import { DevelopmentProcessor } from "../src/development/development-processor.js";
import type { StageRunner } from "../src/engines/abstractions/interface/stage-runner.js";
it.each(["development", "feature"] as const)(
  "%s proves failing checks before implementation, green tests and one independent review in an isolated Git worktree",
  async (kind) => {
    const directory = mkdtempSync(join(tmpdir(), "scabbers-tdd-"));
    const repo = join(directory, "repo");
    mkdirSync(repo);
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git(["init", "-b", "master"]);
    git(["config", "user.name", "Local fixture"]);
    git(["config", "user.email", "fixture@example.test"]);
    writeFileSync(join(repo, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(repo, "bug.ts"),
      "export function shouldClose(){return false;}\n",
    );
    git(["add", "."]);
    git(["commit", "-m", "fixture bug"]);
    const remote = join(directory, "remote.git");
    git(["init", "--bare", remote]);
    git(["remote", "add", "origin", remote]);
    git(["push", "origin", "master"]);
    const store = new Store(join(directory, "state.db"));
    const run = store.create(kind, "SNOLA-FIXTURE", "codex", "profile", {
      scopePending: true,
      issueKey: "SNOLA-FIXTURE",
    });
    run.sessionId = "native-implementation-fixture";
    store.save(run);
    const form = {
      nature: {
        trigger: "Submit",
        expected: "Close",
        observed: "Remains open",
      },
      component: "modal",
      environment: "staging web",
      repositories: ["arcca-pdv"],
      products: ["web"],
      issueType: "Bug",
      labels: [],
      domains: [],
      root_cause: { claim: "Returns false", status: "traced_in_code" },
      evidence: [{ kind: "code", excerpt: "return false", source: "bug.ts" }],
      code: [
        {
          repository: "arcca-pdv",
          path: "bug.ts",
          line: 1,
          excerpt: "return false",
        },
      ],
      proposed_fix: {
        summary: "Return true",
        files: ["arcca-pdv/bug.ts", "arcca-pdv/bug.test.ts"],
        failing_test: "assert shouldClose() is true",
      },
      reproduction: { attempted: false, result: "not_attempted" },
      open_decisions: [],
      risks: [],
      requires_outside_code: { needed: false, action: "read", what: "" },
    };
    let reviews = 0;
    const executor: StageRunner = {
      execute: vi.fn(
        async (current, _instruction, _skill, mode, cwd, _signal, fresh) => {
          const data: Record<string, unknown> = {};
          if (current.state === "investigating") {
            expect(cwd).not.toBe(repo);
            expect(
              execFileSync("git", ["branch", "--show-current"], {
                cwd,
                encoding: "utf8",
              }).trim(),
            ).toBe("");
            expect(current.data.analysisRevisions).toHaveProperty("arcca-pdv");
            if (kind === "development") Object.assign(data, form);
            else if (current.data.featureMember)
              Object.assign(data, {
                key: "SNOLA-1",
                summary: "New close capability",
                acceptance: ["New action closes modal"],
                approach: "Add bounded action",
                dependencies: [],
              });
            else
              Object.assign(data, {
                ...form,
                request: "New action closes modal",
                baseline: "Action unavailable",
                coverage: [
                  {
                    key: "SNOLA-1",
                    acceptance: ["New action closes modal"],
                    approach: "Add action",
                    dependencies: [],
                    disposition: "implement",
                  },
                ],
                implementation: form.proposed_fix,
              });
          }
          if (current.state === "regression" && mode === "edit")
            writeFileSync(
              join(cwd, "bug.test.ts"),
              "import {test} from 'node:test';import {strict as assert} from 'node:assert';import {shouldClose} from './bug.ts';test('reported modal defect',()=>assert.equal(shouldClose(),true));\n",
            );
          if (current.state === "regression" && mode === "read")
            data.testPath = "arcca-pdv/bug.test.ts";
          if (current.state === "fixing")
            writeFileSync(
              join(cwd, "bug.ts"),
              "export function shouldClose(){return true;}\n",
            );
          if (current.state === "review") {
            expect(fresh).toBe(true);
            reviews++;
            current.data.reviewSession = "native-review-fixture";
            store.save(current);
          }
          return {
            status: "passed",
            summary: "Local scripted stage fixture",
            evidence: ["fixture observation"],
            question: null,
            options: [],
            data,
          };
        },
      ),
    };
    const config = configSchema.parse({
      remoteEnabled: true,
      repositories: [
        {
          name: "arcca-pdv",
          path: repo,
          stagingUrl: "https://staging.example.test",
          testCommand: [process.execPath, "--test"],
        },
      ],
    });
    const jira = {
      evidence: vi.fn().mockResolvedValue({
        key: "SNOLA-FIXTURE",
        fields: { issuetype: { name: "Bug" }, labels: [] },
      }),
      transition: vi.fn().mockResolvedValue(undefined),
      comment: vi.fn().mockResolvedValue("fixture-comment"),
      searchPage: vi.fn().mockResolvedValue({ issues: [], isLast: true }),
    };
    if (kind === "feature") {
      jira.evidence.mockResolvedValue({
        key: "SNOLA-1",
        fields: {
          issuetype: { name: "Story" },
          project: { key: "SNOLA" },
          summary: "New close action",
          description: "Implement new modal close action",
          status: { name: "To Do", statusCategory: { key: "new" } },
          labels: [],
          allComments: [],
        },
      } as never);
      run.data.family = await new Hierarchy(jira as never).read("SNOLA-1");
      run.data.scopeMembers = ["SNOLA-1"];
      run.data.issueKey = "SNOLA-1";
      run.data.branchName = "codex/scabbers-snola-1-fixture";
      store.save(run);
    }
    const decisions = { list: () => [], ask: vi.fn() };
    const judge = {
      classifyFeature: vi.fn().mockResolvedValue({
        classification: "A-candidate",
        score: 0.95,
        rubric: "feature-fixture",
        answers: [],
      }),
      classify: vi.fn().mockResolvedValue({
        classification: "A-candidate",
        score: 0.95,
        rubric: "fixture",
        answers: [],
      }),
    };
    try {
      const processor = new DevelopmentProcessor(
        store,
        config,
        executor,
        decisions as never,
        jira as never,
        judge,
        directory,
      );
      for (let i = 0; i < 20 && store.get(run.id).state !== "publication"; i++)
        await processor.processRun(
          store.get(run.id),
          new AbortController().signal,
        );
      const completed = store.get(run.id);
      expect(completed.state).toBe("publication");
      expect((completed.data.regressionTests as any[])[0].code).not.toBe(0);
      expect((completed.data.finalTests as any[])[0].code).toBe(0);
      expect(completed.data.finalTestDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(reviews).toBe(1);
      if (kind === "feature") {
        expect(judge.classifyFeature).toHaveBeenCalledTimes(1);
        expect(judge.classify).not.toHaveBeenCalled();
        expect(
          execFileSync("git", ["branch", "--show-current"], {
            cwd: Object.values(
              completed.data.workspaces as Record<string, string>,
            )[0],
            encoding: "utf8",
          }).trim(),
        ).toBe("codex/scabbers-snola-1-fixture");
      }
      expect(completed.data.workspaces).not.toEqual({ "arcca-pdv": repo });
      expect(
        execFileSync("git", ["show", "master:bug.ts"], {
          cwd: repo,
          encoding: "utf8",
        }),
      ).toContain("false");
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
