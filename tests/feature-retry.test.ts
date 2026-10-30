import { it, expect, vi } from "vitest";
import { Store } from "../src/storage/store.js";
import { Pipeline } from "../src/runtime/pipeline.js";
import { Workflow } from "../src/workflows/workflow.js";
import { configSchema } from "../src/config/types/config.js";
import type { Run } from "../src/workflows/types/run.js";

function waiting(store: Store, resumeStage: string): Run {
  const run = store.create("feature", "retry-fixture", "codex", "profile", {
    resumeStage,
    reviewStarted: true,
    reviewSession: "old-review",
    review: { status: "passed" },
    publications: { repo: {} },
    publicationApproval: "old-digest",
    finalTestDigest: "old-digest",
    e2e: { status: "failed" },
  });
  run.state = "waiting";
  run.snapshot = JSON.stringify({
    status: "active",
    value: "waiting",
    historyValue: {},
    context: {},
    children: {},
  });
  store.save(run);
  return run;
}
function pipeline(store: Store, run: Run, answer: string) {
  const decisions = {
    list: () => [
      {
        id: "current-answer",
        runId: run.id,
        status: "answered",
        question: "Staging decision",
        answer,
      },
    ],
    ask: vi.fn(),
  };
  return new Pipeline(
    store,
    configSchema.parse({ remoteEnabled: true }),
    { execute: vi.fn() } as never,
    {} as never,
    decisions as never,
    undefined,
    undefined,
    "/tmp/scabbers-retry-unit",
  );
}
it("retries browser access in E2E instead of restarting technical investigation", async () => {
  const store = new Store(":memory:");
  try {
    const run = waiting(store, "e2e");
    await pipeline(store, run, "Ready: validate access again").step(
      run,
      new AbortController().signal,
    );
    expect(store.get(run.id).state).toBe("e2e");
    expect(store.get(run.id).data.reviewStarted).toBe(true);
  } finally {
    store.close();
  }
});
it("starts a new bounded revision attempt, preserving previous evidence and invalidating old approvals", async () => {
  const store = new Store(":memory:");
  try {
    const run = waiting(store, "fixing");
    await pipeline(store, run, "Revise attempt").step(
      run,
      new AbortController().signal,
    );
    const next = store.get(run.id);
    expect(next.state).toBe("fixing");
    expect(next.data.deliveryAttempt).toBe(1);
    expect(next.data.previousAttempts).toHaveLength(1);
    expect(next.data.reviewStarted).toBeUndefined();
    expect(next.data.publicationApproval).toBeUndefined();
    expect(next.data.publicationProgress).toBeUndefined();
  } finally {
    store.close();
  }
});
it("honors Pause instead of treating it as permission to revise", async () => {
  const store = new Store(":memory:");
  try {
    const run = waiting(store, "fixing");
    await pipeline(store, run, "Pause").step(run, new AbortController().signal);
    expect(store.get(run.id).state).toBe("waiting");
    expect(store.get(run.id).paused).toBe(1);
  } finally {
    store.close();
  }
});
it("does not accept an earlier attempt's human validation for a new attempt", () => {
  const store = new Store(":memory:");
  try {
    const run = waiting(store, "fixing");
    run.state = "humanValidation";
    run.data.deliveryAttempt = 1;
    run.snapshot = JSON.stringify({
      status: "active",
      value: "humanValidation",
      historyValue: {},
      context: {},
      children: {},
    });
    store.save(run);
    store.db
      .prepare(
        "INSERT INTO decisions(id,runId,userId,question,options,status,answer,createdAt,nextReminder) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "old",
        run.id,
        "owner",
        "Validate staging result: previous attempt",
        "[]",
        "answered",
        "Validated",
        1,
        1,
      );
    expect(() => new Workflow(store).transition(run, "VALIDATED")).toThrow(
      "human",
    );
  } finally {
    store.close();
  }
});
