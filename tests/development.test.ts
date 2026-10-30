import { it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { configSchema } from "../src/config/types/config.js";
import { DevelopmentProcessor } from "../src/development/development-processor.js";
import type { StageRunner } from "../src/engines/abstractions/interface/stage-runner.js";
it("proves an actual failing regression before the fix, then green tests, one independent review and an unchanged final diff in isolated Git worktree", async () => {
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
  const run = store.create("development", "SNOLA-FIXTURE", "codex", "profile", {
    scopePending: true,
    issueKey: "SNOLA-FIXTURE",
  });
  run.sessionId = "native-implementation-fixture";
  store.save(run);
  const form = {
    nature: { trigger: "Submit", expected: "Close", observed: "Remains open" },
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
          Object.assign(data, form);
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
  };
  const decisions = { list: () => [], ask: vi.fn() };
  const judge = {
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
    for (let i = 0; i < 8; i++)
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
});
