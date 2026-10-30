import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, expect } from "vitest";
import { Store } from "../../src/storage/store.js";
import { configSchema } from "../../src/config/types/config.js";
import { DecisionService } from "../../src/decisions/decision-service.js";
import { OperationalApprovals } from "../../src/operations/approvals.js";
import { OperationalProcessor } from "../../src/operations/processor.js";
import { OperationalScriptManager } from "../../src/operations/script-manager.js";
import { operationalPlanSchema } from "../../src/operations/plan-schema.js";
import { operationalImplementationSchema } from "../../src/operations/implementation-schema.js";
export const plan = () =>
  operationalPlanSchema.parse({
    issueKey: "SNOLA-1",
    summary: "Prepare a bounded local fixture operation",
    diagnosis: "A local reviewed marker is absent",
    objective: "Create one marker with read-back evidence",
    evidence: ["Fixture state was inspected"],
    unknowns: [],
    mode: "script",
    environment: "local",
    targets: ["Private operation workspace marker.txt"],
    aws: null,
    steps: ["Refuse an existing marker and create the reviewed value"],
    risks: ["An existing marker must never be overwritten"],
    preconditions: ["Marker absent"],
    successCriteria: ["Marker equals reviewed"],
    testing:
      "Use temporary fixtures to check create, repeat refusal and read-back mismatch",
    rollback: "Manual cleanup after explicit review; no automatic rollback",
    idempotency: "Refuse if marker already exists",
  });
export const bundle = () =>
  operationalImplementationSchema.parse({
    summary: "Fixture implementation, no cloud operations",
    testCases: [
      "Creates expected marker",
      "Refuses duplicate application",
      "Rejects incorrect read-back",
      "Isolated test process cannot see host network interfaces",
    ],
    files: [
      {
        path: "logic.py",
        content:
          'from pathlib import Path\ndef apply(root):\n    p = root / "marker.txt"\n    if p.exists(): raise RuntimeError("already exists")\n    p.write_text("reviewed")\ndef verify(root):\n    p = root / "marker.txt"\n    return p.exists() and p.read_text() == "reviewed"\nif __name__ == "__main__": apply(Path.cwd())\n',
      },
      {
        path: "execute.sh",
        content: 'set -eu\npython3 logic.py\nprintf "fixture applied\\n"\n',
      },
      {
        path: "preflight.sh",
        content:
          'set -eu\npython3 - <<\'PY\'\nimport json\nfrom pathlib import Path\nprint(json.dumps({"checks":[{"criterion":"Marker absent","passed":not Path("marker.txt").exists(),"observed":"checked private fixture existence"}]}))\nPY\n',
      },
      {
        path: "verify.sh",
        content:
          'set -eu\npython3 - <<\'PY\'\nimport json\nfrom pathlib import Path\nfrom logic import verify\nprint(json.dumps({"checks":[{"criterion":"Marker equals reviewed","passed":verify(Path.cwd()),"observed":Path("marker.txt").read_text()}]}))\nPY\n',
      },
      {
        path: "tests.sh",
        content: "set -eu\npython3 -m unittest -v tests_logic.py\n",
      },
      {
        path: "tests_logic.py",
        content:
          'import unittest, tempfile, socket\nfrom pathlib import Path\nfrom logic import apply, verify\nclass LogicTests(unittest.TestCase):\n def test_create(self):\n  with tempfile.TemporaryDirectory() as d:\n   p=Path(d);apply(p);self.assertTrue(verify(p))\n def test_duplicate(self):\n  with tempfile.TemporaryDirectory() as d:\n   p=Path(d);apply(p)\n   with self.assertRaises(RuntimeError): apply(p)\n def test_mismatch(self):\n  with tempfile.TemporaryDirectory() as d:\n   p=Path(d);(p/"marker.txt").write_text("wrong");self.assertFalse(verify(p))\n def test_isolation(self):\n  self.assertEqual([name for _,name in socket.if_nameindex()],["lo"])\n  self.assertEqual(str(Path.home()),"/home/scabbers")\n',
      },
    ],
  });
export const review = () => ({
  approved: true,
  scopeMatchesPlan: true,
  testsMeaningful: true,
  verificationMeaningful: true,
  credentialFree: true,
  checksReadOnly: true,
  findings: [],
  summary: "Fixture independent review",
});
export const verdict = () => ({
  classification: "A-candidate" as const,
  score: 0.98,
  rubric: "fixture-operational",
  answers: [{}],
});
export function fixture(
  options: {
    plan?: ReturnType<typeof plan>;
    bundle?: ReturnType<typeof bundle>;
    runner?: any;
    manualScripts?: any;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-operational-"));
  const store = new Store(":memory:");
  const config = configSchema.parse({
    remoteEnabled: true,
    operations: { enabled: true },
    slack: { user: "UOWNER" },
    jira: {
      baseUrl: "https://fixture.example",
      email: "owner@example.test",
      accountId: "owner-account",
      project: "SNOLA",
    },
  });
  let n = 1;
  const slack = {
    openPrivate: vi.fn(async () => "DOWNER"),
    find: vi.fn(async () => undefined),
    post: vi.fn(async () => String(Date.now() / 1000 + n++ / 1000)),
    react: vi.fn(async () => {}),
    replies: vi.fn(async () => []),
    history: vi.fn(async () => []),
  };
  const decisions = new DecisionService(
    store,
    slack as never,
    "UOWNER",
    config.jira!.baseUrl,
  );
  const approvals = new OperationalApprovals(store, decisions, "UOWNER");
  const scripts =
    options.manualScripts ??
    new OperationalScriptManager(directory, approvals, options.runner);
  const issue = {
    key: "SNOLA-1",
    fields: {
      summary: "Owner fixture Ticket",
      description: "nola-bug-management/report-triage/SNOLA-99",
      issuetype: { name: "Ticket" },
      project: { key: "SNOLA" },
      status: { name: "To Do", statusCategory: { key: "new" } },
      assignee: { accountId: "owner-account" },
      labels: [],
    },
  };
  const jira = {
    issue: vi.fn(async () => issue),
    evidence: vi.fn(async () => issue),
    comment: vi.fn(async () => "receipt"),
    transition: vi.fn(async () => {}),
    readyForReview: vi.fn(async () => true),
  };
  const executor = {
    execute: vi.fn(async (run, ...args) => {
      if (run.state === "investigating")
        return { status: "passed", data: options.plan ?? plan() };
      if (run.state === "building")
        return { status: "passed", data: options.bundle ?? bundle() };
      if (run.state === "review") {
        expect(args.at(-1)).toBe(true);
        run.data.reviewSession = "independent-session";
        store.save(run);
        return { status: "passed", data: review() };
      }
      throw new Error("Unexpected fixture engine state " + run.state);
    }),
  };
  const judge = { classifyOperational: vi.fn(async () => verdict()) };
  const processor = new OperationalProcessor(
    store,
    config,
    executor as never,
    slack as never,
    decisions,
    jira as never,
    judge as never,
    directory,
    scripts,
  );
  const run = store.create(
    "operational",
    "SNOLA-1@fixture",
    "codex",
    "profile",
    { issueKey: issue.key, ownerSlackUser: "UOWNER" },
  );
  const step = async () => {
    const current = store.get(run.id);
    await processor.process(current, new AbortController().signal);
    return store.get(run.id);
  };
  const answer = (
    kind: "plan" | "execute",
    choice?: string,
    user = "UOWNER",
  ) => {
    const current = store.get(run.id),
      id =
        current.data[
          kind === "plan" ? "planDecisionId" : "executionDecisionId"
        ];
    const d = decisions.list().find((d) => d.id === id)!;
    return decisions.accept({
      id: d.id,
      user,
      channel: d.channel!,
      thread: d.thread!,
      receipt: "fixture-" + n++,
      version: d.version,
      answer: choice ?? approvals.option(kind),
      at: Date.now() + 1000,
    });
  };
  const ready = async () => {
    await step();
    await step();
    await step();
    expect(store.get(run.id).state).toBe("planApproval");
    expect(answer("plan")).toBe(true);
    await step();
    await step();
    await step();
    await step();
    expect(store.get(run.id).state).toBe("executionApproval");
    await step();
  };
  return {
    store,
    directory,
    config,
    slack,
    decisions,
    approvals,
    scripts,
    jira,
    issue,
    executor,
    judge,
    run,
    step,
    answer,
    ready,
    close: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
