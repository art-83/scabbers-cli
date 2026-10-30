import { engineEnvironment } from "../engine-environment.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Engine } from "../abstractions/interface/engine.js";
import type { StageInput } from "../types/stage-input.js";
import { stageResultSchema, type StageResult } from "../types/stage-result.js";
import { ProcessRunner } from "../../runtime/process-runner.js";
export class ClaudeEngine implements Engine {
  readonly id = "claude" as const;
  readonly capabilities = {
    nativeSessions: true,
    read: true,
    edit: true,
    nativeBrowser: true,
    browserRequirement:
      "Claude --chrome requires connected official extension, native host, login and explicit navigation authorization",
  };
  constructor(private readonly processRunner = new ProcessRunner()) {}
  async execute(input: StageInput): Promise<StageResult> {
    if (input.mode === "browser" && !input.browserAuthorized)
      throw new Error(
        "Native browser navigation requires explicit per-run authorization",
      );
    const directories = input.directories ?? [input.cwd];
    const session = input.sessionId ?? randomUUID();
    input.onSession(session);
    const args = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--max-budget-usd",
      "5",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--json-schema",
      JSON.stringify(z.toJSONSchema(stageResultSchema, { target: "draft-7" })),
      input.sessionId ? "--resume" : "--session-id",
      session,
    ];
    for (const directory of [
      ...directories,
      ...(input.readDirectories ?? []),
    ].filter((d) => d !== input.cwd))
      args.push("--add-dir", directory);
    if (input.mode === "browser")
      args.push(
        "--chrome",
        "--tools",
        "Read,Grep,Glob",
        "--allowedTools",
        "mcp__claude-in-chrome__*",
      );
    else args.push("--no-chrome");
    if (input.mode === "read")
      args.push(
        "--tools",
        "Read,Grep,Glob",
        "--allowedTools",
        "Read,Grep,Glob",
      );
    else if (input.mode === "edit")
      args.push(
        "--tools",
        "Read,Grep,Glob,Edit,Write",
        "--allowedTools",
        "Read,Grep,Glob," +
          directories.map((directory) => `Edit(/${directory}/**)`).join(","),
      );
    const result = await this.processRunner.run(
      "claude",
      args,
      input.cwd,
      input.prompt,
      () => {},
      input.signal,
      600_000,
      input.onProcess,
      engineEnvironment(),
    );
    if (result.code !== 0)
      throw new Error("Claude failed; native session preserved for recovery");
    const raw = JSON.parse(result.stdout);
    if (raw.session_id !== session || raw.is_error)
      throw new Error("Claude did not confirm the saved native session");
    return stageResultSchema.parse(
      raw.structured_output ?? JSON.parse(raw.result),
    );
  }
}
