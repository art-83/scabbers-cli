import { it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, plan, bundle } from "./fixtures/operational.js";
import { WorkerPool } from "../src/runtime/worker-pool.js";
import { Workflow } from "../src/workflows/workflow.js";
it("runs isolated meaningful unit checks and requires two different explicit approvals before local execution and sanity read-back", async () => {
  const f = fixture();
  try {
    await f.step();
    await f.step();
    await f.step();
    expect(f.executor.execute).toHaveBeenCalledTimes(1);
    expect(f.answer("plan", undefined, "UOTHER")).toBe(false);
    await f.step();
    expect(f.executor.execute).toHaveBeenCalledTimes(1);
    expect(f.answer("plan")).toBe(true);
    await f.step();
    await f.step();
    const artifacts = f.store.get(f.run.id).data.operationalArtifacts as any;
    expect(existsSync(join(artifacts.directory, "marker.txt"))).toBe(false);
    await f.step();
    expect(f.store.get(f.run.id).data.operationalTests).toMatchObject({
      passed: true,
      code: 0,
    });
    await f.step();
    await f.step();
    expect(() => f.approvals.assertExecution(f.store.get(f.run.id))).toThrow();
    expect(existsSync(join(artifacts.directory, "marker.txt"))).toBe(false);
    expect(f.answer("execute")).toBe(true);
    await f.step();
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("verifying");
    expect(readFileSync(join(artifacts.directory, "marker.txt"), "utf8")).toBe(
      "reviewed",
    );
    await f.step();
    await f.step();
    const done = f.store.get(f.run.id);
    expect(done.state).toBe("done");
    expect(done.data.operationalVerification).toMatchObject({
      passed: true,
      code: 0,
    });
    expect(
      f.slack.post.mock.calls.some(([, text]) =>
        text.includes("Operação executada após a segunda aprovação"),
      ),
    ).toBe(true);
    expect(f.jira.readyForReview).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});
it("Resume, generic agreement and a plan approval cannot substitute for the exact implementation approval", async () => {
  const f = fixture();
  try {
    await f.ready();
    new WorkerPool(f.store, 3, async () => {}).control(f.run.id, "resume");
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("executionApproval");
    expect(f.answer("execute", "sim")).toBe(true);
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("executionApproval");
    expect(() => f.approvals.assertExecution(f.store.get(f.run.id))).toThrow();
    expect(
      existsSync(
        join(
          (f.store.get(f.run.id).data.operationalArtifacts as any).directory,
          "marker.txt",
        ),
      ),
    ).toBe(false);
  } finally {
    f.close();
  }
});
it.each(["plan", "implementation", "tests", "review"])(
  "invalidates an old execution approval when %s changes",
  async (kind) => {
    const f = fixture();
    try {
      await f.ready();
      f.answer("execute");
      const r = f.store.get(f.run.id);
      if (kind === "plan")
        (r.data.operationalPlan as any).targets = ["Different target"];
      if (kind === "implementation")
        (r.data.operationalImplementation as any).files[0].content +=
          "\n# changed";
      if (kind === "tests")
        (r.data.operationalTests as any).stdout += "changed";
      if (kind === "review")
        (r.data.operationalReview as any).summary += " changed";
      f.store.save(r);
      expect(() => f.approvals.assertExecution(r)).toThrow();
    } finally {
      f.close();
    }
  },
);
it("checks the real artifact bytes again after approval instead of trusting a reviewed filename", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.answer("execute");
    await f.step();
    const r = f.store.get(f.run.id),
      dir = (r.data.operationalArtifacts as any).directory;
    writeFileSync(join(dir, "execute.sh"), "touch should-never-run");
    await f.step();
    expect(f.store.get(r.id).state).toBe("reconciliation");
    expect(existsSync(join(dir, "should-never-run"))).toBe(false);
    expect(existsSync(join(dir, "marker.txt"))).toBe(false);
  } finally {
    f.close();
  }
});
it("does not repeat a launched operation after a restart or generic retry", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.answer("execute");
    await f.step();
    const r = f.store.get(f.run.id);
    r.data.operationalExecution = {
      status: "started",
      digest: f.approvals.digest(r, "execute"),
    };
    f.store.save(r);
    const execute = vi.spyOn(f.scripts, "execute");
    await f.step();
    expect(execute).not.toHaveBeenCalled();
    expect(f.store.get(r.id).state).toBe("reconciliation");
  } finally {
    f.close();
  }
});
it("does not report success when approved verification observes a mismatch", async () => {
  const b = bundle();
  b.files.find((f) => f.path === "verify.sh")!.content =
    'printf \'{"checks":[{"criterion":"Marker equals reviewed","passed":false,"observed":"wrong"}]}\'';
  const f = fixture({ bundle: b });
  try {
    await f.ready();
    f.answer("execute");
    await f.step();
    await f.step();
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("reconciliation");
    expect(
      f.slack.post.mock.calls.some(([, text]) =>
        text.includes("Operação executada após a segunda aprovação"),
      ),
    ).toBe(false);
  } finally {
    f.close();
  }
});
it("stops before mutation when the AWS account does not match the reviewed target", async () => {
  const p = plan();
  p.environment = "production";
  p.aws = {
    accountId: "111222333444",
    profile: "fixture",
    region: "us-east-1",
  };
  const runner = {
    run: vi.fn(async (command) =>
      command === "aws"
        ? { code: 0, stdout: "999888777666" }
        : { code: 0, stdout: "unit fixtures green" },
    ),
  };
  const f = fixture({ plan: p, runner });
  try {
    await f.ready();
    f.answer("execute");
    await f.step();
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("reconciliation");
    expect(
      runner.run.mock.calls.filter(([command]) => command === "bash"),
    ).toHaveLength(0);
  } finally {
    f.close();
  }
});
it("invalidates a prepared run when Ticket requirements change before the actual operation", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.answer("execute");
    await f.step();
    f.issue.fields.description += " Owner changed requirements";
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("reconciliation");
    expect(f.store.get(f.run.id).data.operationalScopeChanged).toBe(true);
  } finally {
    f.close();
  }
});
it("refuses another assignee before any further stage or Jira write", async () => {
  const f = fixture();
  try {
    f.issue.fields.assignee.accountId = "someone-else";
    await expect(f.step()).rejects.toThrow();
    expect(f.executor.execute).not.toHaveBeenCalled();
    expect(f.jira.comment).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
it("keeps manual-only or JEV-ineligible documentation out of automatic execution", async () => {
  const f = fixture();
  try {
    f.judge.classifyOperational.mockResolvedValue({
      classification: "B" as never,
      score: 0.5,
      rubric: "fixture",
      answers: [],
    });
    await f.ready();
    const pending = f.decisions.list().find((d) => d.status === "pending")!;
    expect(JSON.parse(pending.options)).not.toContain(
      f.approvals.option("execute"),
    );
    expect(() => f.approvals.assertExecution(f.store.get(f.run.id))).toThrow();
  } finally {
    f.close();
  }
});
it("requires an observed completed receipt and refuses unrelated development events", () => {
  const f = fixture();
  try {
    const r = f.store.get(f.run.id);
    new Workflow(f.store).transition(r, "START");
    expect(() => new Workflow(f.store).transition(r, "FORM")).toThrow();
    expect(r.state).toBe("investigating");
  } finally {
    f.close();
  }
});

it("requires a new test and independent review even if a new approval is requested for modified implementation data", async () => {
  const f = fixture();
  try {
    await f.ready();
    const r = f.store.get(f.run.id);
    (r.data.operationalImplementation as any).files[0].content +=
      "\n# new revision";
    f.store.save(r);
    await f.approvals.request(r, "execute");
    f.answer("execute");
    expect(() => f.approvals.assertExecution(f.store.get(r.id))).toThrow();
    await f.step();
    expect(f.store.get(r.id).state).toBe("building");
  } finally {
    f.close();
  }
});

it.each(["pause", "cancel"] as const)(
  "revokes execution capability immediately on %s",
  async (action) => {
    const f = fixture();
    try {
      await f.ready();
      f.answer("execute");
      const before = f.store.get(f.run.id);
      new WorkerPool(f.store, 3, async () => {}).control(f.run.id, action);
      expect(() => f.approvals.assertExecution(before)).toThrow();
    } finally {
      f.close();
    }
  },
);

it("refuses stale approval versions and cannot reuse approval receipts from another run", async () => {
  const f = fixture();
  try {
    await f.ready();
    f.answer("execute");
    const r = f.store.get(f.run.id);
    f.store.db
      .prepare("UPDATE decisions SET version=version+1 WHERE id=?")
      .run(String(r.data.executionDecisionId));
    expect(() => f.approvals.assertExecution(r)).toThrow();
    const other = f.store.create(
      "operational",
      "SNOLA-2",
      "codex",
      "profile",
      r.data,
    );
    expect(f.approvals.answer(other, "plan")).toBeUndefined();
  } finally {
    f.close();
  }
});

it("keeps a failed local unit check before independent review and offers no execution approval", async () => {
  const b = bundle();
  b.files.find((file) => file.path === "tests.sh")!.content = "exit 1\n";
  const f = fixture({ bundle: b });
  try {
    await f.step();
    await f.step();
    await f.step();
    f.answer("plan");
    await f.step();
    await f.step();
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("building");
    expect(f.store.get(f.run.id).data.operationalTests).toMatchObject({
      passed: false,
      code: 1,
    });
    expect(
      f.executor.execute.mock.calls.some(([run]) => run.state === "review"),
    ).toBe(false);
    expect(
      f.decisions.list().some((d) => d.question.includes("execução desta")),
    ).toBe(false);
  } finally {
    f.close();
  }
});

it("can hand execution to the owner after documentation without running or claiming an operation", async () => {
  const f = fixture();
  try {
    await f.ready();
    const execute = vi.spyOn(f.scripts, "execute");
    f.answer("execute", "Executar manualmente");
    await f.step();
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("done");
    expect(execute).not.toHaveBeenCalled();
    expect(
      f.slack.post.mock.calls.some(([, text]) =>
        text.includes("Nenhuma operação foi executada"),
      ),
    ).toBe(true);
  } finally {
    f.close();
  }
});

it("does not create artifacts when the owner declines the creation plan", async () => {
  const f = fixture();
  try {
    const prepare = vi.spyOn(f.scripts, "prepare");
    await f.step();
    await f.step();
    await f.step();
    f.answer("plan", "Executar manualmente");
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("handoff");
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
