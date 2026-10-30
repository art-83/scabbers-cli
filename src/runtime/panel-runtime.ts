import { spawn, type ChildProcess } from "node:child_process";
import { request } from "./client.js";
export class PanelRuntime {
  private child: ChildProcess | undefined;
  private stopping = false;
  constructor(
    private readonly directory: string,
    private readonly entrypoint: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}
  async start(): Promise<void> {
    let existing = false;
    try {
      await request(this.directory, { action: "status" });
      existing = true;
    } catch {}
    if (existing)
      throw new Error(
        "A Scabbers runtime is already running. Close its panel, or stop an older background runtime with scabbers --stop, before opening this panel",
      );
    let failure: Error | undefined;
    this.child = spawn(
      process.execPath,
      [...process.execArgv, this.entrypoint, "--daemon"],
      { stdio: ["ignore", "ignore", "ignore", "ipc"], env: this.environment },
    );
    this.child.once("error", (error) => {
      failure = error;
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (failure)
        throw new Error("Cannot start panel runtime: " + failure.message);
      let status: { pid?: number } | undefined;
      try {
        status = await request(this.directory, { action: "status" });
      } catch {}
      if (status) {
        if (status.pid !== this.child.pid)
          throw new Error(
            "Another panel acquired this runtime; the current panel will not take ownership",
          );
        return;
      }
      if (this.child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Panel runtime did not start; inspect the saved text logs");
  }
  async stop(): Promise<void> {
    if (this.stopping || !this.child) return;
    this.stopping = true;
    try {
      const status = await request(this.directory, { action: "status" });
      if (status.pid === this.child.pid)
        await request(this.directory, { action: "stop", pid: this.child.pid });
    } catch {
      this.child.kill("SIGTERM");
    }
    if (this.child.connected) this.child.disconnect();
  }
}
