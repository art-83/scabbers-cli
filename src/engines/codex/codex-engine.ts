import { engineEnvironment } from "../engine-environment.js";
import type { Engine } from "../abstractions/interface/engine.js";
import type { StageInput } from "../types/stage-input.js";
import { stageResultSchema, type StageResult } from "../types/stage-result.js";
import { ProcessRunner } from "../../runtime/process-runner.js";
export class CodexEngine implements Engine {
  readonly id = "codex" as const;
  readonly capabilities = {
    nativeSessions: true,
    read: true,
    edit: true,
    nativeBrowser: false,
    browserRequirement:
      "Desktop browser tools have no verified public CLI transport. Select Claude with Chrome for staging E2E.",
  };
  constructor(private readonly processRunner = new ProcessRunner()) {}
  async execute(input: StageInput): Promise<StageResult> {
    if (input.mode === "browser")
      throw new Error(this.capabilities.browserRequirement);
    let session: string | null = input.sessionId;
    let text = "";
    const args = [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "-c",
      'approval_policy="never"',
      "-c",
      `sandbox_mode="${input.mode === "read" ? "read-only" : "workspace-write"}"`,
      "-c",
      "sandbox_workspace_write.network_access=false",
    ];
    if (input.mode === "edit" && input.directories?.length)
      args.push(
        "-c",
        "sandbox_workspace_write.writable_roots=" +
          JSON.stringify(input.directories),
      );
    if (session) args.push("resume", session);
    args.push("-");
    const result = await this.processRunner.run(
      "codex",
      args,
      input.cwd,
      input.prompt +
        "\nReturn only JSON matching: " +
        JSON.stringify({
          status: "passed|failed|blocked|question",
          summary: "string",
          evidence: ["observed evidence"],
          question: null,
          options: [],
          data: {},
        }),
      (line) => {
        const event = JSON.parse(line);
        if (event.type === "thread.started") {
          if (session && session !== event.thread_id)
            throw new Error("Session mismatch");
          session = event.thread_id;
          input.onSession(session!);
        }
        if (
          event.type === "item.completed" &&
          event.item?.type === "agent_message"
        )
          text = event.item.text;
      },
      input.signal,
      600_000,
      input.onProcess,
      engineEnvironment(),
    );
    if (result.code || !session)
      throw new Error("Codex failed; inspect saved session before retry");
    return stageResultSchema.parse(JSON.parse(text));
  }
}
