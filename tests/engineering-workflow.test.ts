import { it, expect, vi } from "vitest";
import { EngineeringWorkflow } from "../src/development/engineering-workflow.js";
import { FamilyPolicy } from "../src/features/family-policy.js";
import { FeatureDelivery } from "../src/features/delivery.js";
import { configSchema } from "../src/config/types/config.js";
import { Store } from "../src/storage/store.js";
import { JiraClient } from "../src/integrations/jira/jira-client.js";
import type { Family } from "../src/features/types/family.js";
function family(status: string): Family {
  return {
    root: "PNOLA-1",
    digest: "fixture",
    complete: true,
    ancestors: [],
    members: [
      {
        key: "PNOLA-1",
        fields: {
          project: { key: "PNOLA" },
          issuetype: { name: "Epic" },
          description: "Product context",
          assignee: { accountId: "owner-fixture" },
          labels: [],
          status: { name: status, statusCategory: { key: "indeterminate" } },
        },
      },
      {
        key: "SNOLA-2",
        fields: {
          project: { key: "SNOLA" },
          issuetype: { name: "Story" },
          description: "Implement this",
          assignee: { accountId: "owner-fixture" },
          labels: [],
          status: { name: "To Do", statusCategory: { key: "new" } },
        },
      },
    ],
  };
}
it.each(["Ready for Dev", "Delivery"])(
  "treats product Epic status %s as context without blocking To Do engineering work",
  (status) => {
    expect(new FamilyPolicy().blocker(family(status))).toBeUndefined();
  },
);
it.each(["Ready for QA", "In QA", "Done", "In Prod"])(
  "rejects feature transitions beyond the agreed boundary: %s",
  (status) => {
    expect(() => new EngineeringWorkflow().assertTarget(status)).toThrow(
      "Ready for Code Review",
    );
    expect(
      configSchema.safeParse({
        development: {
          transitions: {
            "SNOLA/Story": {
              claim: "In Progress",
              documented: "Docs & Tests",
              validated: status,
            },
          },
        },
      }).success,
    ).toBe(false);
  },
);
it("permits the declared engineering sequence including Open in the To Do column", () => {
  for (const status of EngineeringWorkflow.statuses)
    expect(() => new EngineeringWorkflow().assertTarget(status)).not.toThrow();
});
it("keeps Epic product status unchanged even when a workflow mapping exists", async () => {
  const store = new Store(":memory:"),
    jira = { transition: vi.fn(), comment: vi.fn(async () => "receipt") };
  try {
    const config = configSchema.parse({
      jira: {
        baseUrl: "https://fixture.example",
        email: "fixture@example.test",
        accountId: "owner-fixture",
        project: "SNOLA",
      },
      development: {
        transitions: {
          "PNOLA/Epic": {
            claim: "In Progress",
            documented: "Docs & Tests",
            validated: "Ready for Code Review",
          },
          "SNOLA/Story": {
            claim: "In Progress",
            documented: "Docs & Tests",
            validated: "Ready for Code Review",
          },
        },
      },
    });
    const run = store.create("feature", "root-context", "codex", "profile", {
      family: family("Ready for Dev"),
      scopeMembers: ["SNOLA-2"],
    });
    await new FeatureDelivery(store, jira as never, config).recordProgress(
      run,
      "claim",
      "Started engineering work",
    );
    expect(jira.transition).toHaveBeenCalledTimes(1);
    expect(jira.transition.mock.calls[0]?.[1]).toBe("SNOLA-2");
    expect(jira.comment).toHaveBeenCalledTimes(2);
  } finally {
    store.close();
  }
});
it("blocks an out-of-scope transition at the Jira adapter boundary before any HTTP call", async () => {
  const store = new Store(":memory:");
  try {
    const run = store.create(
      "feature",
      "transition-guard",
      "codex",
      "profile",
      {},
    );
    const config = configSchema.parse({
      jira: {
        baseUrl: "https://fixture.example",
        email: "fixture@example.test",
        accountId: "fixture",
        project: "SNOLA",
      },
    });
    await expect(
      new JiraClient(config.jira!, "fixture", store).transition(
        run.id,
        "SNOLA-2",
        "Ready for QA",
        "forbidden",
      ),
    ).rejects.toThrow("approved scope");
  } finally {
    store.close();
  }
});
