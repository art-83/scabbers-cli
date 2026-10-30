import React from "react";
import { it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
vi.mock("../src/runtime/client.js", () => ({
  request: vi.fn().mockResolvedValue({
    pid: 123,
    remoteEnabled: false,
    engine: "claude",
    workers: 3,
    profile: null,
    runtimeError: null,
    runs: [],
    decisions: [],
    integrations: [
      {
        name: "Slack",
        status: "connected",
        detail: "Verified",
        checkedAt: Date.now(),
      },
      {
        name: "Jira",
        status: "disconnected",
        detail: "Not configured",
        checkedAt: Date.now(),
      },
    ],
  }),
}));
import { App } from "../src/tui/app.js";
import { request } from "../src/runtime/client.js";
it("renders both work areas and switches tabs without starting another runtime", async () => {
  const app = render(<App directory="/tmp/scabbers-ui-test" />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(app.lastFrame()).toContain("SCABBERS");
  expect(app.lastFrame()).toContain("Support");
  expect(app.lastFrame()).toContain("Development");
  expect(app.lastFrame()).toContain("AUTOMATION OFF");
  expect(app.lastFrame()).toContain("✓ Slack: Connected");
  expect(app.lastFrame()).toContain("✗ Jira: Not connected");
  expect(app.lastFrame()).toContain("… GitLab: Checking");
  const header = app.lastFrame()!.split("\n");
  const slackLine = header.findIndex((line) => line.includes("✓ Slack"));
  expect(header[slackLine + 1]).toContain("✗ Jira");
  expect(header[slackLine + 2]).toContain("… GitLab");
  expect(header.at(-1)).toContain("q Detach");
  expect(app.lastFrame()).toContain("Tab Next tab │");
  expect(app.lastFrame()).toContain("←/→ Switch tab │");
  app.stdin.write("\t");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(app.lastFrame()).toContain("No executions in development");
  app.stdin.write("\t");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(app.lastFrame()).toContain("Configuration");
  expect(app.lastFrame()).toContain("Enter Edit");
  app.stdin.write("\u001b[D");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(app.lastFrame()).toContain("No executions in development");
  Object.defineProperty(app.stdout, "columns", {
    value: 70,
    configurable: true,
  });
  Object.defineProperty(app.stdout, "rows", { value: 22, configurable: true });
  app.stdout.emit("resize");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(app.lastFrame()!.split("\n")).toHaveLength(22);
  expect(app.lastFrame()!.split("\n").at(-1)).toContain("q Detach");
  app.unmount();
});

it("requires selecting activation with arrows and Enter; typed yes does not activate", async () => {
  vi.mocked(request).mockResolvedValue({
    pid: 123,
    remoteEnabled: false,
    engine: "claude",
    workers: 3,
    profile: null,
    runtimeError: null,
    runs: [],
    decisions: [],
    activation: { digest: "reviewed-settings" },
  });
  const app = render(<App directory="/tmp/scabbers-ui-test" />);
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    app.stdin.write("e");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.lastFrame()).toContain("› Return without activation");
    app.stdin.write("y");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      vi
        .mocked(request)
        .mock.calls.some(([, command]) => command.action === "activate"),
    ).toBe(false);
    app.stdin.write("\u001b[B");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.lastFrame()).toContain(
      "› Activate automation with these settings",
    );
    app.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(request).toHaveBeenCalledWith("/tmp/scabbers-ui-test", {
      action: "activate",
      digest: "reviewed-settings",
    });
  } finally {
    app.unmount();
  }
});
