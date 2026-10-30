import { it, expect, vi } from "vitest";
import { Store } from "../src/storage/store.js";
import { InvestigationJournal } from "../src/runtime/investigation-journal.js";
import { InvestigatedStageRunner } from "../src/runtime/investigated-stage-runner.js";
import { fixture, plan } from "./fixtures/operational.js";
import { WorkerPool } from "../src/runtime/worker-pool.js";
import { InvestigationInputs } from "../src/runtime/investigation-inputs.js";

it("documents a blocked but useful manual plan and still evaluates preparation without authorizing execution", async () => {
  const p = plan();
  p.mode = "manual";
  const f = fixture({ plan: p });
  try {
    f.executor.execute.mockResolvedValueOnce({
      status: "blocked",
      summary: "Counter history could not be read",
      evidence: ["Pinned source read", "Live counter unavailable"],
      question: null,
      options: [],
      data: {
        creationPlan: p,
        missingCapabilities: ["Read-only current counter lookup"],
      },
    } as never);
    await f.step();
    await f.step();
    expect(f.store.get(f.run.id).state).toBe("handoff");
    expect(f.store.get(f.run.id).data.operationalPlan).toEqual(p);
    expect(
      f.store.get(f.run.id).data.operationalPreparationLimitations,
    ).toMatchObject({
      missingCapabilities: ["Read-only current counter lookup"],
    });
    expect(f.judge.classifyOperational).toHaveBeenCalledTimes(1);
    expect(
      f.jira.comment.mock.calls.some(([, , body]) =>
        body.includes("Read-only current counter lookup"),
      ),
    ).toBe(true);
    expect(f.decisions.list()).toHaveLength(0);
    expect(() => f.approvals.assertExecution(f.store.get(f.run.id))).toThrow();
  } finally {
    f.close();
  }
});

it("does not turn a blocked executable plan into authorization to build or execute", async () => {
  const f = fixture();
  try {
    f.executor.execute.mockResolvedValueOnce({
      status: "blocked",
      summary: "Essential evidence unavailable",
      evidence: ["Current target unknown"],
      question: null,
      options: [],
      data: { creationPlan: plan() },
    } as never);
    await f.step();
    await expect(f.step()).rejects.toThrow("needs verified evidence");
    expect(f.store.get(f.run.id).state).toBe("investigating");
    expect(f.judge.classifyOperational).not.toHaveBeenCalled();
    expect(f.decisions.list()).toHaveLength(0);
  } finally {
    f.close();
  }
});

it("preserves detailed findings before a Jira outage and retries documentation without another model call", async () => {
  const f = fixture();
  try {
    const run = f.store.get(f.run.id);
    run.state = "investigating";
    f.store.save(run);
    const data = {
      facts: ["Pinned source path: module.ts:12"],
      hypotheses: ["Requires live verification"],
      missingCapabilities: ["Read-only resource lookup"],
      details: "Observed information ".repeat(1500),
    };
    const result = {
      status: "blocked",
      summary: "Investigation stopped before mutation",
      evidence: ["Tests read, not executed"],
      question: null,
      options: [],
      data,
    };
    const delegate = { execute: vi.fn(async () => result) };
    f.jira.comment.mockRejectedValueOnce(new Error("Jira unavailable"));
    const runner = new InvestigatedStageRunner(
      f.store,
      delegate as never,
      f.jira as never,
    );
    const call = () =>
      runner.execute(
        f.store.get(run.id),
        "Investigate",
        "fixture",
        "read",
        f.directory,
        new AbortController().signal,
      );
    await expect(call()).rejects.toThrow("Jira unavailable");
    expect(f.store.get(run.id).data.investigationLatest).toBeTruthy();
    const resumed = new InvestigatedStageRunner(
      f.store,
      delegate as never,
      f.jira as never,
    );
    expect(
      await resumed.execute(
        f.store.get(run.id),
        "Investigate",
        "fixture",
        "read",
        f.directory,
        new AbortController().signal,
      ),
    ).toEqual(result);
    expect(delegate.execute).toHaveBeenCalledTimes(1);
    const comments = f.jira.comment.mock.calls.map((c) => c[2]);
    expect(comments.every((c) => c.length < 11000)).toBe(true);
    expect(comments.join("\n")).toContain("Read-only resource lookup");
    expect(comments.join("\n")).toContain("module.ts:12");
    expect(comments.join("\n")).toContain("Requires live verification");
  } finally {
    f.close();
  }
});

it("reinvestigates after a new owner answer instead of reusing unrelated pending evidence", async () => {
  const f = fixture();
  try {
    const run = f.store.get(f.run.id);
    run.state = "investigating";
    f.store.save(run);
    const delegate = {
      execute: vi.fn(async () => ({
        status: "passed",
        summary: "Verified",
        evidence: ["Local source"],
        question: null,
        options: [],
        data: {},
      })),
    };
    f.jira.comment.mockRejectedValueOnce(new Error("offline"));
    const runner = new InvestigatedStageRunner(
      f.store,
      delegate as never,
      f.jira as never,
    );
    await expect(
      runner.execute(
        run,
        "Investigate",
        "fixture",
        "read",
        f.directory,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    run.data.humanAnswer = { question: "Scope?", answer: "Changed scope" };
    f.store.save(run);
    await runner.execute(
      run,
      "Investigate",
      "fixture",
      "read",
      f.directory,
      new AbortController().signal,
    );
    expect(delegate.execute).toHaveBeenCalledTimes(2);
  } finally {
    f.close();
  }
});

it("invalidates evidence for new human messages but ignores its own documentation and collection timestamps", () => {
  const f = fixture();
  try {
    const run = f.store.get(f.run.id),
      inputs = new InvestigationInputs(),
      journal = new InvestigationJournal(f.store);
    run.data.issue = structuredClone(f.issue);
    run.data.originThreads = [
      {
        channel: "C1",
        thread: "1.1",
        capturedAt: 1,
        messages: [{ text: "Initial evidence", ts: "1.1" }],
      },
    ];
    const before = journal.fingerprint(inputs.read(run));
    (run.data.issue as any).fields.allComments = [
      { body: "Scabbers investigation scabbers:run:investigation:hash" },
    ];
    (run.data.originThreads as any)[0].capturedAt = 2;
    expect(journal.fingerprint(inputs.read(run))).toBe(before);
    (run.data.issue as any).fields.allComments.push({
      body: "Owner added a new requirement",
    });
    expect(journal.fingerprint(inputs.read(run))).not.toBe(before);
  } finally {
    f.close();
  }
});

it("documents context-member analysis on an owned scope card rather than writing to a foreign Epic", async () => {
  const f = fixture();
  try {
    const run = f.store.create("feature", "family", "codex", "profile", {
      issueKey: "PNOLA-1",
      scopeMembers: ["SNOLA-1"],
      featureMember: { key: "PNOLA-1" },
    });
    const journal = new InvestigationJournal(f.store, f.jira as never);
    const r = journal.record(run, "digest", "fixture", {
      status: "passed",
      summary: "Epic used as context",
      evidence: ["All child descriptions considered"],
      question: null,
      options: [],
      data: {},
    });
    await journal.publish(run, r);
    expect(f.jira.comment.mock.calls.every((c) => c[1] === "SNOLA-1")).toBe(
      true,
    );
    expect(f.jira.comment.mock.calls[0]?.[2]).toContain(
      "**Card analisado:** PNOLA-1",
    );
  } finally {
    f.close();
  }
});

it("writes technical blockers and JEV handoffs idempotently without creating a Slack decision", async () => {
  const f = fixture();
  try {
    const r = f.store.get(f.run.id);
    const journal = new InvestigationJournal(f.store, f.jira as never);
    await journal.blocker(r, "A required readonly capability is unavailable");
    const count = f.jira.comment.mock.calls.length;
    await journal.blocker(r, "A required readonly capability is unavailable");
    expect(f.jira.comment).toHaveBeenCalledTimes(count);
    await journal.eligibility(
      r,
      { classification: "B", score: 0.6 },
      { risks: ["Essential scope unknown"] },
    );
    expect(f.jira.comment.mock.calls.at(-1)?.[2]).toContain(
      "Essential scope unknown",
    );
    expect(f.decisions.list()).toHaveLength(0);
    expect(f.slack.post).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

it("redacts credentials before sending detailed investigation text to Jira", async () => {
  const f = fixture();
  try {
    const run = f.store.get(f.run.id),
      journal = new InvestigationJournal(f.store, f.jira as never);
    await journal.blocker(run, 'password="fixture-do-not-publish"');
    expect(f.jira.comment.mock.calls.map((c) => c[2]).join("\n")).not.toContain(
      "fixture-do-not-publish",
    );
    expect(f.jira.comment.mock.calls.map((c) => c[2]).join("\n")).toContain(
      "REDACTED",
    );
  } finally {
    f.close();
  }
});

it("keeps a failed worker checkpoint visible when its reporter deliberately creates no private decision", async () => {
  const store = new Store(":memory:");
  try {
    const run = store.create("operational", "SNOLA-1", "codex", "profile", {
      issueKey: "SNOLA-1",
    });
    const report = vi.fn(async () => undefined);
    const pool = new WorkerPool(
      store,
      3,
      async () => {
        throw new Error("Missing capability");
      },
      report,
    );
    await pool.tick();
    for (let i = 0; i < 10 && pool.activeCount; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(report).toHaveBeenCalledTimes(1);
    expect(store.get(run.id).error).toBe("Missing capability");
    expect(store.get(run.id).data.blockerDecision).toBeUndefined();
    expect(
      store.db.prepare("SELECT COUNT(*) AS n FROM decisions").get()?.n,
    ).toBe(0);
  } finally {
    store.close();
  }
});
