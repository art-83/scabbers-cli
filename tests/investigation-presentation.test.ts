import { it, expect, vi, afterEach } from "vitest";
import { InvestigationPresentation } from "../src/runtime/investigation-presentation.js";
import { JiraMarkdownDocument } from "../src/integrations/jira/markdown-document.js";
import { JiraClient } from "../src/integrations/jira/jira-client.js";
import { fixture } from "./fixtures/operational.js";
import { InvestigationJournal } from "../src/runtime/investigation-journal.js";
afterEach(() => vi.unstubAllGlobals());

it("presents nested findings, risk and recommendations as readable Markdown while preserving evidence", () => {
  const f = fixture();
  try {
    const journal = new InvestigationJournal(f.store);
    const record = journal.record(f.run, "format", "fixture", {
      status: "blocked",
      summary: "Plan requires review",
      evidence: ["module.ts:12 was inspected"],
      question: "Choose scope?",
      options: ["Small", "Broad"],
      decision: {
        choices: [
          { label: "Small", consequence: "Keeps scope" },
          { label: "Broad", consequence: "Changes scope" },
        ],
        recommendedIndex: 0,
        reason: "Existing requirements support the smaller change",
      },
      data: {
        risks: ["Existing behavior must be preserved"],
        coverage: [
          {
            key: "SNOLA-1",
            approach: "Reuse the existing helper",
            dependencies: [],
          },
        ],
        technicalBlocker: 'password="fixture-do-not-publish"',
      },
    });
    const markdown = new InvestigationPresentation().markdown(record);
    expect(markdown).toContain("### Evidências consultadas");
    expect(markdown).toContain("- module.ts:12 was inspected");
    expect(markdown).toContain("**Opção recomendada:** 1. Small");
    expect(markdown).toContain("Existing behavior must be preserved");
    expect(markdown).toContain("Reuse the existing helper");
    expect(markdown).not.toContain('"coverage":');
    expect(markdown).not.toContain("fixture-do-not-publish");
    const doc = new JiraMarkdownDocument().render(markdown) as any;
    expect(doc.content.some((n: any) => n.type === "heading")).toBe(true);
    expect(doc.content.some((n: any) => n.type === "bulletList")).toBe(true);
    expect(doc.content.some((n: any) => n.type === "orderedList")).toBe(true);
    expect(JSON.stringify(doc)).not.toContain("### Evidências");
  } finally {
    f.close();
  }
});

it("sends Markdown as native Jira headings, lists and emphasis without changing plain comment behavior", async () => {
  const f = fixture();
  try {
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        if (init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ id: String(bodies.length) }));
        }
        return new Response(JSON.stringify({ comments: [], total: 0 }));
      }),
    );
    const jira = new JiraClient(f.config.jira!, "fixture", f.store);
    const run = f.store.create(
      "support",
      "format-source",
      "codex",
      "profile",
      {},
    );
    await jira.markdownComment(
      run.id,
      "SNOLA-1",
      "## Conclusão\n\n**Estado:** Revisar\n\n- Evidência\n- Risco",
      "markdown-format",
    );
    expect(bodies[0].body.content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 2 },
    });
    expect(
      bodies[0].body.content.find((n: any) => n.type === "bulletList").content,
    ).toHaveLength(2);
    expect(JSON.stringify(bodies[0])).toContain('"type":"strong"');
    await jira.comment(
      run.id,
      "SNOLA-1",
      "## Literal plain text",
      "plain-format",
    );
    expect(bodies[1].body.content[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "## Literal plain text" }],
    });
  } finally {
    f.close();
  }
});
