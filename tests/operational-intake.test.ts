import { it, expect, vi } from "vitest";
import { fixture, plan } from "./fixtures/operational.js";
import { OperationalIntake } from "../src/operations/intake.js";
import { JiraReviewProgression } from "../src/integrations/jira/review-progression.js";
import { JevClient } from "../src/integrations/jev/jev-client.js";

it("discovers only owner-assigned routed Tickets, deduplicates and preserves prior remote execution evidence after local reset", async () => {
  const f = fixture();
  try {
    const profile = vi.fn(() => ({ version: "profile" }) as never);
    const intake = new OperationalIntake(
      f.store,
      f.config,
      f.jira as never,
      profile,
    );
    const issue = structuredClone(f.issue) as any;
    issue.key = "SNOLA-2";
    for (const invalid of [
      {
        ...issue,
        fields: { ...issue.fields, assignee: { accountId: "other" } },
      },
      { ...issue, fields: { ...issue.fields, labels: ["no-auto"] } },
      { ...issue, fields: { ...issue.fields, issuetype: { name: "Bug" } } },
      {
        ...issue,
        fields: { ...issue.fields, description: "unrelated Ticket" },
      },
      {
        ...issue,
        fields: {
          ...issue.fields,
          allComments: [
            { text: "scabbers:x:operational-execution-started:hash" },
          ],
        },
      },
      {
        ...issue,
        fields: {
          ...issue.fields,
          status: { statusCategory: { key: "done" } },
        },
      },
    ])
      intake.enqueue(invalid);
    expect(profile).not.toHaveBeenCalled();
    intake.enqueue(issue);
    intake.enqueue(issue);
    expect(
      f.store.list().filter((r) => r.data.issueKey === issue.key),
    ).toHaveLength(1);
    intake.stop();
    issue.key = "SNOLA-3";
    intake.enqueue(issue);
    expect(f.store.list().some((r) => r.data.issueKey === issue.key)).toBe(
      false,
    );
  } finally {
    f.close();
  }
});

it("resumes Jira pagination with the owner filter, discards stale owner cursors, and does not enqueue an in-flight page after stop", async () => {
  const f = fixture();
  try {
    const searchPage = vi.fn(async () => ({
      issues: [],
      isLast: false,
      nextPageToken: "next",
    }));
    const intake = new OperationalIntake(
      f.store,
      f.config,
      { ...f.jira, searchPage } as never,
      () => ({ version: "profile" }) as never,
    );
    await intake.sweep();
    searchPage.mockResolvedValueOnce({
      issues: [],
      isLast: true,
      nextPageToken: undefined,
    } as never);
    await intake.sweep();
    expect(searchPage.mock.calls[0]?.[0]).toContain(
      'assignee = "owner-account"',
    );
    expect(searchPage.mock.calls[1]?.[1]).toBe("next");
    f.store.setSetting("operational-scan", {
      fingerprint: "other-owner",
      nextPageToken: "wrong",
    });
    searchPage.mockImplementationOnce(async () => {
      intake.stop();
      return {
        issues: [{ ...f.issue, key: "SNOLA-4" }],
        isLast: true,
      } as never;
    });
    await intake.sweep();
    expect(searchPage.mock.calls[2]?.[1]).toBeUndefined();
    expect(f.jira.evidence).not.toHaveBeenCalled();
    expect(f.store.list()).toHaveLength(1);
  } finally {
    f.close();
  }
});

it("advances through verified engineering transitions and never substitutes QA or Done for review", async () => {
  let current = "To Do";
  const move = vi.fn(async (next: string) => {
    current = next;
  });
  const http = {
    request: vi.fn(async (path: string) =>
      path.endsWith("/transitions")
        ? {
            transitions: [
              { to: { name: "Ready for QA" } },
              {
                to: {
                  name:
                    current === "To Do"
                      ? "Solution Analysis"
                      : "Ready for Code Review",
                },
              },
              { to: { name: "Done" } },
            ],
          }
        : { fields: { status: { name: current } } },
    ),
  };
  expect(
    await new JiraReviewProgression(http as never, move).advance("SNOLA-1"),
  ).toBe(true);
  expect(move.mock.calls.map((c) => c[0])).toEqual([
    "Solution Analysis",
    "Ready for Code Review",
  ]);
  current = "Ready for QA";
  move.mockClear();
  expect(
    await new JiraReviewProgression(http as never, move).advance("SNOLA-1"),
  ).toBe(false);
  expect(move).not.toHaveBeenCalled();
});

it("uses a separate operational JEV rubric, reversed criteria and sanitized evidence without treating production work as a bug", async () => {
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
  const p = plan();
  p.environment = "production";
  p.aws = {
    accountId: "123456789012",
    profile: "fixture",
    region: "us-east-1",
  };
  p.evidence.push("Private Customer Name provided the evidence");
  const judge = new JevClient("fixture", transport as typeof fetch);
  const result = await judge.classifyOperational(p, ["Private Customer Name"]);
  expect(result.classification).toBe("A-candidate");
  expect(result.rubric).toContain("operational");
  const bodies = transport.mock.calls.map((c) => JSON.parse(c[1].body));
  expect(bodies).toHaveLength(2);
  expect(Object.keys(bodies[0].questions.autonomous_track.criteria)).toEqual(
    Object.keys(bodies[1].questions.autonomous_track.criteria).reverse(),
  );
  expect(JSON.stringify(bodies)).not.toMatch(
    /Private Customer Name|SNOLA-1|123456789012/,
  );
  p.mode = "manual";
  expect((await judge.classifyOperational(p, [])).classification).toBe("C");
});
