import { it, expect, vi } from "vitest";
import { Store } from "../src/storage/store.js";
import { Effects } from "../src/runtime/effects.js";
import { ReportResolver } from "../src/integrations/jira/report-resolver.js";
it("records Product handoff without creating an RFC or closing the Report", async () => {
  const store = new Store(":memory:");
  const calls: any[] = [];
  const comments: any[] = [];
  const http = {
    request: vi.fn(async (path, method = "GET", body) => {
      calls.push({ path, method });
      if (path.includes("/comment?"))
        return { comments, total: comments.length };
      if (method === "POST" && path.endsWith("/comment")) {
        const comment = { id: "1", body: body.body };
        comments.push(comment);
        return comment;
      }
      return {
        fields: { issuetype: { name: "Report" }, status: { name: "To Do" } },
      };
    }),
  };
  try {
    const resolver = new ReportResolver(http as never, new Effects(store));
    const plan = {
      type: "product" as const,
      summary: "Expected behavior needs Product",
      description:
        "Pertinent conclusion only; request belongs to Product evaluation.",
    };
    expect(await resolver.resolve("run", "SNOLA-10", plan)).toBe("SNOLA-10");
    await resolver.resolve("run", "SNOLA-10", plan);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([
      { path: "/rest/api/3/issue/SNOLA-10/comment", method: "POST" },
    ]);
  } finally {
    store.close();
  }
});
it("refuses a closed duplicate destination before any remote write", async () => {
  const store = new Store(":memory:");
  const http = {
    request: vi.fn(async (path) =>
      path.endsWith("SNOLA-10")
        ? { fields: { issuetype: { name: "Report" } } }
        : {
            key: "SNOLA-11",
            fields: {
              issuetype: { name: "Bug" },
              status: { statusCategory: { key: "done" } },
            },
          },
    ),
  };
  try {
    await expect(
      new ReportResolver(http as never, new Effects(store)).resolve(
        "run",
        "SNOLA-10",
        {
          type: "duplicate",
          summary: "Duplicate",
          description: "Evidence",
          destinationKey: "SNOLA-11",
        },
      ),
    ).rejects.toThrow("open verified Bug");
    expect(http.request.mock.calls.every((call) => call[1] === undefined)).toBe(
      true,
    );
  } finally {
    store.close();
  }
});
it("requires a real allowed cancellation reason before any mutation", async () => {
  const store = new Store(":memory:");
  const http = {
    request: vi.fn(async (path) =>
      path.endsWith("/editmeta")
        ? { fields: {} }
        : { fields: { issuetype: { name: "Report" } } },
    ),
  };
  try {
    await expect(
      new ReportResolver(http as never, new Effects(store)).resolve(
        "run",
        "SNOLA-10",
        {
          type: "cancel",
          summary: "Expected behavior",
          description: "Evidence",
          cancellationReason: "Comportamento esperado",
        },
      ),
    ).rejects.toThrow("reason field/option");
    expect(http.request.mock.calls.every((call) => call[1] === undefined)).toBe(
      true,
    );
  } finally {
    store.close();
  }
});
it("recovers cancellation after response loss without repeating the transition or losing the reason", async () => {
  const store = new Store(":memory:");
  const state: any = {
    fields: {
      issuetype: { name: "Report" },
      status: { id: "open", name: "To Do", statusCategory: { key: "new" } },
    },
  };
  const comments: any[] = [];
  let transitions = 0;
  const http = {
    request: vi.fn(async (path, method = "GET", body) => {
      if (path.endsWith("/editmeta"))
        return {
          fields: {
            customfield_reason: {
              name: "Motivo de cancelamento",
              allowedValues: [
                { id: "reason-id", value: "Comportamento esperado" },
              ],
            },
          },
        };
      if (path.endsWith("/transitions") && method === "GET")
        return {
          transitions: [
            {
              id: "cancel",
              to: {
                id: "closed",
                name: "Cancelled",
                statusCategory: { key: "done" },
              },
            },
          ],
        };
      if (path.includes("/comment?"))
        return { comments, total: comments.length };
      if (path.endsWith("/comment") && method === "POST") {
        const comment = { id: "c1", body: body.body };
        comments.push(comment);
        return comment;
      }
      if (method === "PUT") {
        Object.assign(state.fields, body.fields);
        return undefined;
      }
      if (path.endsWith("/transitions") && method === "POST") {
        transitions++;
        state.fields.status = {
          id: "closed",
          name: "Cancelled",
          statusCategory: { key: "done" },
        };
        throw new Error("response lost");
      }
      return structuredClone(state);
    }),
  };
  try {
    const resolver = new ReportResolver(http as never, new Effects(store));
    const plan = {
      type: "cancel" as const,
      summary: "Expected behavior",
      description: "Observed and confirmed expected behavior",
      cancellationReason: "Comportamento esperado",
    };
    await expect(resolver.resolve("run", "SNOLA-10", plan)).rejects.toThrow(
      "response lost",
    );
    expect(await resolver.resolve("run", "SNOLA-10", plan)).toBe("SNOLA-10");
    expect(transitions).toBe(1);
    expect(state.fields.customfield_reason.id).toBe("reason-id");
  } finally {
    store.close();
  }
});
