import { FeatureAnalysis } from "../src/features/analysis.js";
import { describe, it, expect, vi } from "vitest";
import { configSchema } from "../src/config/types/config.js";
import { Store } from "../src/storage/store.js";
import { Hierarchy } from "../src/features/hierarchy.js";
import { FeatureIntake } from "../src/features/intake.js";
import { FamilyPolicy } from "../src/features/family-policy.js";
import { FeatureDelivery } from "../src/features/delivery.js";
import { FeaturePlan } from "../src/features/feature-plan.js";
import { featureFormSchema } from "../src/features/feature-form-schema.js";
import { JevClient } from "../src/integrations/jev/jev-client.js";
import { Workflow } from "../src/workflows/workflow.js";
import { WorkerPool } from "../src/runtime/worker-pool.js";
import type { IssueTracker } from "../src/integrations/abstractions/interface/issue-tracker.js";
import type { JiraIssue } from "../src/integrations/types/jira-issue.js";
import type { Family } from "../src/features/types/family.js";
import type { IntakePreview } from "../src/features/types/intake-preview.js";

function card(
  key: string,
  type = "Story",
  parent?: string,
  category = "new",
): JiraIssue {
  return {
    key,
    fields: {
      summary: `Request ${key}`,
      description: "Explicit requested behavior",
      issuetype: { name: type, subtask: type === "Sub-task" },
      project: { key: key.split("-")[0]! },
      status: {
        name:
          category === "new"
            ? "To Do"
            : category === "done"
              ? "Done"
              : "In Progress",
        statusCategory: { key: category },
      },
      labels: [],
      ...(parent ? { parent: { key: parent } } : {}),
      allComments: [],
    },
  };
}
class JiraFixture implements IssueTracker {
  readonly issues: Record<string, JiraIssue>;
  seeds: string[];
  constructor(issues: JiraIssue[], seeds = issues.map((i) => i.key)) {
    this.issues = Object.fromEntries(issues.map((i) => [i.key, i]));
    this.seeds = seeds;
  }
  evidence = vi.fn(async (key: string) => {
    if (!this.issues[key]) throw new Error("HTTP 403 inaccessible parent");
    return structuredClone(this.issues[key]!);
  });
  issue = this.evidence;
  board = vi.fn(async () => ({
    name: "Unified fixture",
    filterId: "10594",
    statusIds: ["10003", "1"],
  }));
  searchPage = vi.fn(async (jql: string, token?: string) => {
    const parent = /parent = "([^"]+)"/.exec(jql)?.[1];
    const issues = parent
      ? Object.values(this.issues).filter(
          (i) => i.fields.parent?.key === parent,
        )
      : this.seeds.map((k) => this.issues[k]!);
    const index = Number(token ?? 0);
    return {
      issues: issues.slice(index, index + 1),
      isLast: index + 1 >= issues.length,
      ...(index + 1 < issues.length
        ? { nextPageToken: String(index + 1) }
        : {}),
    };
  });
  comment = vi.fn(async () => "comment-receipt");
  transition = vi.fn(async () => {});
  route = vi.fn(async () => "SNOLA-999");
}
const configuration = () =>
  configSchema.parse({ engine: "codex", development: { enabled: true } });
const profile = () => ({
  version: "profile-fixture",
  content: "Preferences only",
  source: "test",
});
function form(family: Family) {
  return featureFormSchema.parse({
    request: "Add requested ordering",
    baseline: "Only the previous order exists",
    component: "history",
    environment: "staging",
    repositories: ["arcca-pdv"],
    products: ["web"],
    issueType: "Epic",
    labels: [],
    domains: [],
    coverage: family.members.map((i) => ({
      key: i.key,
      acceptance: ["New ordering is observable"],
      approach: "Inspect and extend query",
      dependencies: [],
      disposition:
        i.fields.status?.statusCategory?.key === "done"
          ? "context"
          : "implement",
    })),
    implementation: {
      summary: "Add bounded sort parameter",
      files: ["arcca-pdv/history.ts", "arcca-pdv/history.test.ts"],
      failing_test: "Assert new sort order",
    },
    evidence: [
      {
        kind: "requirement",
        excerpt: "Explicit ordering acceptance",
        source: "selected card",
      },
    ],
    code: [
      {
        repository: "arcca-pdv",
        path: "history.ts",
        line: 1,
        excerpt: "return query(order);",
      },
    ],
    open_decisions: [],
    risks: [],
    requires_outside_code: { needed: false, action: "read", what: "" },
  });
}
async function preview(
  store: Store,
  jira: JiraFixture,
): Promise<IntakePreview> {
  const intake = new FeatureIntake(store, configuration(), jira, profile);
  return intake.advance(true, 500);
}
describe("Complete resumable Jira families", () => {
  it("walks cross-project ancestors and paginated descendants including completed context", async () => {
    const jira = new JiraFixture(
      [
        card("PNOLA-1", "Epic"),
        card("SNOLA-2", "Story", "PNOLA-1"),
        card("SNOLA-3", "Task", "PNOLA-1", "done"),
        card("SNOLA-4", "Sub-task", "SNOLA-2"),
      ],
      ["SNOLA-2"],
    );
    const family = await new Hierarchy(jira).read("SNOLA-4");
    expect(family.root).toBe("PNOLA-1");
    expect(family.members.map((i) => i.key).sort()).toEqual([
      "PNOLA-1",
      "SNOLA-2",
      "SNOLA-3",
      "SNOLA-4",
    ]);
    expect(
      jira.searchPage.mock.calls.some(
        ([jql, token]) => jql.includes('parent = "PNOLA-1"') && token === "1",
      ),
    ).toBe(true);
  });
  it("keeps an orphan Story and its subtasks as one unit without inventing an epic", async () => {
    const jira = new JiraFixture([
      card("SNOLA-1"),
      card("SNOLA-2", "Sub-task", "SNOLA-1"),
    ]);
    expect((await new Hierarchy(jira).read("SNOLA-2")).root).toBe("SNOLA-1");
  });
  it("resumes serialized discovery without claiming an incomplete family is complete", async () => {
    const jira = new JiraFixture([
      card("PNOLA-1", "Epic"),
      card("SNOLA-2", "Task", "PNOLA-1"),
    ]);
    const hierarchy = new Hierarchy(jira);
    let state = hierarchy.create("SNOLA-2");
    await hierarchy.step(state);
    expect(() => hierarchy.complete(state)).toThrow("incomplete");
    state = JSON.parse(JSON.stringify(state));
    for (let i = 0; i < 30 && !state.complete; i++)
      await new Hierarchy(jira).step(state);
    expect(hierarchy.complete(state).members).toHaveLength(2);
  });
  it("blocks parent cycles and unreadable ancestors", async () => {
    const jira = new JiraFixture([
      card("SNOLA-1", "Story", "SNOLA-2"),
      card("SNOLA-2", "Story", "SNOLA-1"),
    ]);
    await expect(new Hierarchy(jira).read("SNOLA-1")).rejects.toThrow("cycle");
    delete jira.issues["SNOLA-2"];
    await expect(new Hierarchy(jira).read("SNOLA-1")).rejects.toThrow("403");
  });
  it("does not hide inaccessible subtasks omitted from search", async () => {
    const issue = card("SNOLA-1");
    issue.fields.subtasks = [{ key: "SNOLA-99" }];
    await expect(
      new Hierarchy(new JiraFixture([issue])).read(issue.key),
    ).rejects.toThrow("403");
  });
  it("blocks pagination that repeats a continuation token", async () => {
    const jira = new JiraFixture([card("PNOLA-1", "Epic")]);
    jira.searchPage.mockImplementation(async () => ({
      issues: [],
      isLast: false,
      nextPageToken: "same",
    }));
    await expect(new Hierarchy(jira).read("PNOLA-1")).rejects.toThrow(
      "pagination stalled",
    );
  });
  it("fingerprints requirements and membership but ignores Scabbers comments/status bookkeeping", async () => {
    const jira = new JiraFixture([card("SNOLA-1")]);
    const hierarchy = new Hierarchy(jira);
    const original = await hierarchy.read("SNOLA-1");
    jira.issues["SNOLA-1"]!.fields.allComments = [
      { id: "1", body: "scabbers:fixture documentation" },
    ];
    jira.issues["SNOLA-1"]!.fields.status!.name = "Docs & Tests";
    expect((await hierarchy.read("SNOLA-1")).digest).toBe(original.digest);
    jira.issues["SNOLA-1"]!.fields.description = "Changed requirement";
    expect((await hierarchy.read("SNOLA-1")).digest).not.toBe(original.digest);
  });
});
describe("Distinct durable feature intake", () => {
  it("previews the mapped board column without enqueuing or changing Jira", async () => {
    const store = new Store(":memory:");
    const jira = new JiraFixture(
      [
        card("PNOLA-1", "Epic"),
        card("SNOLA-2", "Story", "PNOLA-1"),
        card("SNOLA-3", "Bug"),
      ],
      ["SNOLA-2", "SNOLA-3"],
    );
    try {
      const state = await preview(store, jira);
      expect(state.status).toBe("complete");
      expect(state.jql).toContain("status IN (10003, 1)");
      expect(state.families).toHaveLength(1);
      expect(state.excluded).toEqual([
        expect.objectContaining({ key: "SNOLA-3" }),
      ]);
      expect(store.list()).toHaveLength(0);
      expect(jira.comment).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });
  it("deduplicates siblings across pages and restarts into a single epic branch owner", async () => {
    const store = new Store(":memory:");
    const jira = new JiraFixture(
      [
        card("PNOLA-1", "Epic"),
        card("SNOLA-2", "Task", "PNOLA-1"),
        card("SNOLA-3", "Story", "PNOLA-1"),
      ],
      ["SNOLA-2", "SNOLA-3"],
    );
    try {
      await preview(store, jira);
      await new FeatureIntake(store, configuration(), jira, profile).advance(
        false,
        500,
      );
      await new FeatureIntake(store, configuration(), jira, profile).advance(
        false,
        500,
      );
      const runs = store.list();
      expect(runs).toHaveLength(1);
      expect(runs[0]!.kind).toBe("feature");
      expect(runs[0]!.data.branchName).toContain("pnola-1");
      expect((runs[0]!.data.family as Family).members).toHaveLength(3);
    } finally {
      store.close();
    }
  });
  it("requires a completed preview and does not enqueue a partial family", async () => {
    const store = new Store(":memory:");
    const jira = new JiraFixture([card("SNOLA-1")]);
    try {
      const intake = new FeatureIntake(store, configuration(), jira, profile);
      await expect(intake.advance(false)).rejects.toThrow("preview");
      const state = await intake.advance(true, 2);
      expect(state.status).toBe("discovering");
      expect(store.list()).toHaveLength(0);
    } finally {
      store.close();
    }
  });
  it("retries a persisted inaccessible hierarchy without falsely creating an orphan", async () => {
    const store = new Store(":memory:");
    const jira = new JiraFixture(
      [card("SNOLA-1", "Story", "PNOLA-1")],
      ["SNOLA-1"],
    );
    try {
      const intake = new FeatureIntake(store, configuration(), jira, profile);
      const blocked = await intake.advance(true, 100);
      expect(blocked.families).toHaveLength(0);
      expect(blocked.blockedDiscoveries).toHaveLength(1);
      expect(store.list()).toHaveLength(0);
      jira.issues["PNOLA-1"] = card("PNOLA-1", "Epic");
      const state = await new FeatureIntake(
        store,
        configuration(),
        jira,
        profile,
      ).advance(true, 100, true);
      expect(state.status).toBe("complete");
      expect(state.families[0]!.root).toBe("PNOLA-1");
    } finally {
      store.close();
    }
  });
  it("blocks active scope changes and permits a later version after the previous run is closed", async () => {
    const store = new Store(":memory:");
    const jira = new JiraFixture(
      [card("PNOLA-1", "Epic"), card("SNOLA-2", "Story", "PNOLA-1")],
      ["SNOLA-2"],
    );
    try {
      await preview(store, jira);
      const intake = new FeatureIntake(store, configuration(), jira, profile);
      await intake.advance(false, 500);
      const run = store.list()[0]!;
      jira.issues["SNOLA-3"] = card("SNOLA-3", "Task", "PNOLA-1");
      await intake.advance(false, 500);
      expect(store.list()).toHaveLength(1);
      expect(store.get(run.id).data.scopeChanged).toBe(true);
      run.state = "done";
      store.save(run);
      await intake.advance(false, 500);
      expect(store.list()).toHaveLength(2);
    } finally {
      store.close();
    }
  });
  it.each(["no-auto", "mixed", "active"])(
    "excludes unsafe families: %s",
    async (reason) => {
      const issue = card(
        "SNOLA-2",
        reason === "mixed" ? "Bug" : "Story",
        "PNOLA-1",
        reason === "active" ? "indeterminate" : "new",
      );
      if (reason === "no-auto") issue.fields.labels = ["no-auto"];
      const store = new Store(":memory:");
      const jira = new JiraFixture(
        [card("PNOLA-1", "Epic"), issue],
        ["PNOLA-1"],
      );
      try {
        const state = await preview(store, jira);
        expect(state.excluded[0]!.reason).toMatch(/Opt-out|mixed|Active/);
        await new FeatureIntake(store, configuration(), jira, profile).advance(
          false,
          500,
        );
        expect(store.list()).toHaveLength(0);
      } finally {
        store.close();
      }
    },
  );
});
describe("Feature delivery and factual guards", () => {
  it("requires complete coverage and preserves completed cards as context", async () => {
    const family = await new Hierarchy(
      new JiraFixture([
        card("PNOLA-1", "Epic"),
        card("SNOLA-2", "Story", "PNOLA-1", "done"),
      ]),
    ).read("PNOLA-1");
    const policy = new FamilyPolicy(),
      valid = form(family);
    expect(() => policy.coverage(valid, family, ["PNOLA-1"])).not.toThrow();
    valid.coverage.pop();
    expect(() => policy.coverage(valid, family, ["PNOLA-1"])).toThrow(
      "every family",
    );
  });
  it("rechecks scope after an approval wait instead of caching old family evidence", async () => {
    const store = new Store(":memory:"),
      jira = new JiraFixture([card("SNOLA-1")]);
    const family = await new Hierarchy(jira).read("SNOLA-1");
    try {
      const run = store.create("feature", "scope", "codex", "profile", {
        family,
        scopeMembers: ["SNOLA-1"],
      });
      run.state = "publication";
      store.save(run);
      const delivery = new FeatureDelivery(store, jira, configuration());
      expect(await delivery.verifyScope(run)).toBe(true);
      jira.issues["SNOLA-1"]!.fields.description = "Changed after approval";
      await expect(delivery.verifyScope(run)).rejects.toThrow("changed");
    } finally {
      store.close();
    }
  });
  it("keeps unmapped epic workflows unchanged and never comments on completed children", async () => {
    const store = new Store(":memory:"),
      jira = new JiraFixture([
        card("PNOLA-1", "Epic"),
        card("SNOLA-2", "Story", "PNOLA-1", "done"),
      ]);
    const family = await new Hierarchy(jira).read("PNOLA-1");
    try {
      const run = store.create("feature", "progress", "codex", "profile", {
        family,
        scopeMembers: ["PNOLA-1"],
      });
      await new FeatureDelivery(store, jira, configuration()).recordProgress(
        run,
        "claim",
        "Acceptance failure observed",
      );
      expect(jira.transition).not.toHaveBeenCalled();
      expect(jira.comment.mock.calls[0]?.[1]).toBe("PNOLA-1");
    } finally {
      store.close();
    }
  });
  it("applies the same failing-test and publication guards to feature runs", async () => {
    const store = new Store(":memory:");
    try {
      const run = store.create("feature", "guards", "codex", "profile", {}),
        workflow = new Workflow(store);
      workflow.transition(run, "START");
      workflow.transition(run, "FORM");
      run.data.jev = { classification: "A-candidate" };
      expect(() => workflow.transition(run, "ELIGIBLE")).toThrow();
    } finally {
      store.close();
    }
  });
  it("shares the global worker cap and member locks across Bug Fix and Development", async () => {
    const store = new Store(":memory:"),
      jira = new JiraFixture([card("SNOLA-1")]);
    const family = await new Hierarchy(jira).read("SNOLA-1");
    let release: () => void = () => {};
    const waiting = new Promise<void>((r) => (release = r));
    try {
      store.create("feature", "family", "codex", "profile", {
        family,
        issueKey: "SNOLA-1",
      });
      store.create("development", "bug", "codex", "profile", {
        issueKey: "SNOLA-1",
      });
      store.create("support", "unrelated", "codex", "profile", {});
      const step = vi.fn(async () => waiting);
      const pool = new WorkerPool(store, 3, step);
      await pool.tick();
      expect(step).toHaveBeenCalledTimes(2);
      expect(pool.activeCount).toBe(2);
      release();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      store.close();
    }
  });
});
it("revises the feature plan from authenticated product answers before evaluating eligibility again", async () => {
  const store = new Store(":memory:"),
    jira = new JiraFixture([card("SNOLA-1")]);
  try {
    const family = await new Hierarchy(jira).read("SNOLA-1"),
      initial = form(family);
    initial.open_decisions = [
      { question: "Choose ordering", proposed_default: "Date" },
    ];
    const run = store.create("feature", "answered-scope", "codex", "profile", {
      family,
      scopeMembers: ["SNOLA-1"],
      featureForm: initial,
      form: new FeaturePlan().toDelivery(initial),
      analysisWorkspaces: { "arcca-pdv": "/tmp/fixture-analysis" },
      jev: { classification: "A-candidate" },
    });
    run.state = "eligibility";
    store.save(run);
    const revised = {
      ...initial,
      open_decisions: [],
      request: "Order by ID as explicitly selected",
    };
    const executor = {
      execute: vi.fn(async () => ({
        status: "passed",
        summary: "Plan refined",
        evidence: ["Authenticated answer"],
        question: null,
        options: [],
        data: revised,
      })),
    };
    const decisions = {
      list: () => [
        {
          id: "answer1",
          runId: run.id,
          status: "answered",
          question: "Choose ordering",
          answer: "ID",
        },
      ],
      ask: vi.fn(),
    };
    expect(
      await new FeatureAnalysis(
        store,
        executor as never,
        decisions as never,
      ).resolveDecisions(run, new AbortController().signal),
    ).toBe(true);
    expect((store.get(run.id).data.featureForm as any).request).toContain("ID");
    expect(store.get(run.id).data.jev).toBeUndefined();
    expect(store.get(run.id).data.appliedFeatureDecisions).toEqual(["answer1"]);
  } finally {
    store.close();
  }
});
describe("Feature-specific JEV rubric", () => {
  it("uses feature criteria, both alternative orders and sanitized evidence", async () => {
    const family = await new Hierarchy(
      new JiraFixture([card("PNOLA-1", "Epic")]),
    ).read("PNOLA-1");
    const transport = vi.fn(async (_url: unknown, init: any) => {
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          usage: { input_tokens: 1, output_tokens: 1 },
          answers: Object.fromEntries(
            Object.entries(body.questions).map(([key, q]: [string, any]) => [
              key,
              q.type === "choice"
                ? {
                    type: "choice",
                    choice: "eligible",
                    confidence: 0.95,
                    probabilities: {
                      eligible: 0.95,
                      eligible_with_decision: 0.03,
                      not_eligible: 0.02,
                    },
                  }
                : { type: "noul", noul: 0.95 },
            ]),
          ),
        }),
      );
    });
    const answer = await new JevClient(
      "fixture",
      transport as typeof fetch,
    ).classifyFeature(form(family), []);
    expect(answer.classification).toBe("A-candidate");
    expect(answer.rubric).toContain("feature");
    expect(transport).toHaveBeenCalledTimes(2);
    const bodies = transport.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(Object.keys(bodies[0].questions.autonomous_track.criteria)).toEqual(
      Object.keys(bodies[1].questions.autonomous_track.criteria).reverse(),
    );
    expect(JSON.stringify(bodies)).not.toContain("PNOLA-1");
    expect(
      new FeaturePlan().toDelivery(form(family)).proposed_fix.files,
    ).toHaveLength(2);
  });
  it("fails closed on unavailable JEV and opt-out facts", async () => {
    const family = await new Hierarchy(
      new JiraFixture([card("PNOLA-1", "Epic")]),
    ).read("PNOLA-1");
    await expect(
      new JevClient(
        "fixture",
        vi.fn(async () => new Response("{}", { status: 503 })),
      ).classifyFeature(form(family), []),
    ).rejects.toThrow("unavailable");
  });
});
