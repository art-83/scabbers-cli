import { it, expect, vi, afterEach } from "vitest";
import { JiraClient } from "../src/integrations/jira/jira-client.js";
import { Store } from "../src/storage/store.js";
import { configSchema } from "../src/config/types/config.js";
afterEach(() => vi.unstubAllGlobals());
it("uses enhanced token pagination and resolves the real saved board filter and column statuses", async () => {
  const store = new Store(":memory:");
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    const path = url.pathname;
    if (path.endsWith("/configuration"))
      return new Response(
        JSON.stringify({
          name: "Unified board",
          filter: { id: 10594 },
          columnConfig: {
            columns: [{ name: "To Do", statuses: [{ id: 10003 }, { id: 1 }] }],
          },
        }),
      );
    if (path.includes("/filter/"))
      return new Response(JSON.stringify({ jql: "project = EXAMPLE" }));
    const body = JSON.parse(String(init.body));
    expect(body.nextPageToken).toBe("next");
    expect(init.method).toBe("POST");
    expect(path).toBe("/rest/api/3/search/jql");
    return new Response(JSON.stringify({ issues: [], isLast: true }));
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const config = configSchema.parse({
      jira: {
        baseUrl: "https://fixture.example",
        email: "fixture@example.test",
        accountId: "fixture",
        project: "SNOLA",
      },
    });
    const client = new JiraClient(config.jira!, "fixture", store);
    expect(await client.board(28)).toEqual({
      filterId: "10594",
      statusIds: ["10003", "1"],
      name: "Unified board",
    });
    expect((await client.searchPage("filter = 10594", "next")).isLast).toBe(
      true,
    );
  } finally {
    store.close();
  }
});
it("rejects an incomplete search response rather than ending pagination silently", async () => {
  const store = new Store(":memory:");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ issues: [], isLast: false })),
    ),
  );
  try {
    const config = configSchema.parse({
      jira: {
        baseUrl: "https://fixture.example",
        email: "fixture@example.test",
        accountId: "fixture",
        project: "SNOLA",
      },
    });
    await expect(
      new JiraClient(config.jira!, "fixture", store).searchPage(
        "filter = 10594",
      ),
    ).rejects.toThrow("incomplete");
  } finally {
    store.close();
  }
});
