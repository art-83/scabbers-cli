import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JiraImages } from "../src/integrations/jira/jira-images.js";
import { HttpClient } from "../src/integrations/http-client.js";
import { CodexEngine } from "../src/engines/codex/codex-engine.js";
import { ClaudeEngine } from "../src/engines/claude/claude-engine.js";
import { StageExecutor } from "../src/runtime/stage-executor.js";
import { Store } from "../src/storage/store.js";
import { configSchema } from "../src/config/types/config.js";
const folders: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  folders.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZXkAAAAASUVORK5CYII=",
  "base64",
);
const signal = () => new AbortController().signal;
const issue = (attachment: Record<string, unknown> = {}) => ({
  key: "PNOLA-664",
  fields: {
    issuetype: { name: "Epic" },
    project: { key: "PNOLA" },
    description: null,
    attachment: [
      {
        id: "45868",
        filename: "../../unsafe.png",
        mimeType: "image/png",
        size: png.length,
        content: "https://untrusted.example/steal",
        ...attachment,
      },
    ],
  },
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-images-"));
  folders.push(directory);
  const http = { image: vi.fn(async () => png) };
  return { directory, http, images: new JiraImages(http as never, directory) };
}
it("downloads verified Jira IDs, retains provenance and private content-addressed files, ignores supplied URLs and filenames", async () => {
  const f = fixture();
  const result = await f.images.prepare([issue(), issue()], signal());
  expect(f.http.image).toHaveBeenCalledExactlyOnceWith(
    "/rest/api/3/attachment/content/45868?redirect=false",
    expect.any(AbortSignal),
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    issueKey: "PNOLA-664",
    attachmentId: "45868",
  });
  expect(readFileSync(result[0]!.path)).toEqual(png);
  expect(statSync(result[0]!.path).mode & 0o777).toBe(0o600);
  expect(statSync(f.directory).mode & 0o777).toBe(0o700);
  await f.images.prepare([issue()], signal());
  expect(f.http.image).toHaveBeenCalledTimes(1);
  writeFileSync(result[0]!.path, "corrupted");
  await f.images.prepare([issue()], signal());
  expect(f.http.image).toHaveBeenCalledTimes(2);
});
it("rejects unsupported, oversized, mislabeled, excessive and unsafe image evidence without silently omitting it", async () => {
  for (const attachment of [
    { mimeType: "image/svg+xml" },
    { id: "../escape" },
    { size: 6 * 1024 * 1024 },
  ]) {
    const f = fixture();
    await expect(
      f.images.prepare([issue(attachment)], signal()),
    ).rejects.toThrow();
    expect(f.http.image).not.toHaveBeenCalled();
  }
  const f = fixture();
  f.http.image.mockResolvedValue(Buffer.from("<html>Login</html>"));
  await expect(f.images.prepare([issue()], signal())).rejects.toThrow(
    "Invalid Jira image content",
  );
  const many = Array.from({ length: 13 }, (_, i) => issue({ id: String(i) }));
  await expect(fixture().images.prepare(many, signal())).rejects.toThrow(
    "More than 12",
  );
});
it("does not download non-image files or run after cancellation", async () => {
  const f = fixture();
  expect(
    await f.images.prepare([issue({ mimeType: "application/pdf" })], signal()),
  ).toEqual([]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    f.images.prepare([issue()], controller.signal),
  ).rejects.toThrow();
  expect(f.http.image).not.toHaveBeenCalled();
});
it("bounds streaming downloads and keeps authentication on the configured origin with redirects disabled", async () => {
  const fetchMock = vi.fn(async () => new Response(png));
  vi.stubGlobal("fetch", fetchMock);
  const http = new HttpClient("https://jira.example", {
    Authorization: "fixture",
  });
  await expect(
    http.image("https://other.example/image", signal()),
  ).rejects.toThrow("origin");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    await http.image(
      "/rest/api/3/attachment/content/1?redirect=false",
      signal(),
    ),
  ).toEqual(png);
  expect(fetchMock.mock.calls[0]![1]).toMatchObject({
    redirect: "error",
    headers: { Authorization: "fixture" },
  });
  fetchMock.mockImplementation(
    async () => new Response(new Uint8Array(5 * 1024 * 1024 + 1)),
  );
  await expect(http.image("/image", signal())).rejects.toThrow("5 MiB");
  fetchMock.mockImplementation(
    async () => new Response("denied", { status: 403 }),
  );
  await expect(http.image("/image", signal())).rejects.toThrow("403");
});
const result = {
  status: "passed",
  summary: "Fixture",
  evidence: ["Fixture"],
  question: null,
  options: [],
  data: {},
};
const input = {
  runId: "fixture",
  stage: "investigating",
  cwd: process.cwd(),
  prompt: "Inspect Jira evidence",
  sessionId: null,
  mode: "read" as const,
  browserAuthorized: false,
  onSession: vi.fn(),
  imagePaths: ["/private/jira-images/1.png"],
  readDirectories: ["/private/jira-images"],
};
it.each([null, "saved-native-session"])(
  "attaches images to new and resumed Codex turns (%s)",
  async (sessionId) => {
    const runner = {
      run: vi.fn(async (_c, _a, _d, _p, line) => {
        line(
          JSON.stringify({
            type: "thread.started",
            thread_id: sessionId ?? "new-session",
          }),
        );
        line(
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: JSON.stringify(result) },
          }),
        );
        return { code: 0, stdout: "" };
      }),
    };
    await new CodexEngine(runner as never).execute({ ...input, sessionId });
    const args = runner.run.mock.calls[0]![1];
    expect(args.slice(-3)).toEqual(["--image", input.imagePaths[0], "-"]);
    if (sessionId)
      expect(args.indexOf("--image")).toBeGreaterThan(args.indexOf("resume"));
  },
);
it("gives Claude explicit local image Read instructions and bounded directory access without enabling network tools", async () => {
  const runner = {
    run: vi.fn(async (_c, args) => ({
      code: 0,
      stdout: JSON.stringify({
        session_id: args[args.indexOf("--session-id") + 1],
        structured_output: result,
      }),
    })),
  };
  await new ClaudeEngine(runner as never).execute(input);
  const args = runner.run.mock.calls[0]![1];
  const prompt = runner.run.mock.calls[0]![3];
  expect(args).toContain("/private/jira-images");
  expect(args).toContain("Read,Grep,Glob");
  expect(args).toContain("--no-chrome");
  expect(prompt).toContain(input.imagePaths[0]);
  expect(prompt).toContain("Read tool");
});
it("passes epic and current child images into the controller stage, saves provenance and blocks launch on unavailable images", async () => {
  const f = fixture();
  const skill = join(f.directory, "SKILL.md");
  writeFileSync(skill, "Read only fixture");
  const store = new Store(":memory:");
  try {
    const root = issue();
    const child = { ...issue({ id: "45869" }), key: "SNOLA-1" };
    const run = store.create("feature", "images", "codex", "profile", {
      soulSnapshot: {
        version: "profile",
        content: "Approved fixture",
        source: "fixture",
      },
      family: {
        root: root.key,
        ancestors: [root],
        members: [root, child],
        digest: "fixture",
        complete: true,
      },
      featureMember: child,
    });
    const prepare = vi.fn(async () => [
      {
        issueKey: root.key,
        attachmentId: "45868",
        filename: "RFC.png",
        mimeType: "image/png",
        sha256: "verified",
        path: join(f.directory, "verified.png"),
      },
    ]);
    const execute = vi.fn(async () => result);
    const config = configSchema.parse({ skillPaths: { fixture: skill } });
    const executor = new StageExecutor(
      store,
      new Map([
        [
          "codex",
          {
            id: "codex",
            capabilities: { nativeBrowser: true },
            execute,
          } as never,
        ],
      ]),
      {} as never,
      config,
      { prepare },
    );
    await executor.execute(
      run,
      "Analyze",
      "fixture",
      "read",
      process.cwd(),
      signal(),
      true,
    );
    expect(prepare).toHaveBeenCalledWith(
      [root, child],
      expect.any(AbortSignal),
    );
    const stage = execute.mock.calls[0]![0];
    expect(stage.imagePaths).toEqual([join(f.directory, "verified.png")]);
    expect(stage.readDirectories).toContain(f.directory);
    expect(stage.prompt).toContain("Jira visual evidence manifest");
    expect(store.get(run.id).data.imageEvidence).toHaveLength(1);
    prepare.mockRejectedValue(new Error("Image inaccessible"));
    await expect(
      executor.execute(
        run,
        "Analyze",
        "fixture",
        "read",
        process.cwd(),
        signal(),
      ),
    ).rejects.toThrow("Image inaccessible");
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    store.close();
  }
});
