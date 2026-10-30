import { PanelRuntime } from "../src/runtime/panel-runtime.js";
import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "../src/runtime/client.js";
import { Store } from "../src/storage/store.js";
it("reconnects to one daemon and recovers persisted workflow/session after a crash with remote processing off", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-daemon-"));
  const cli = resolve("dist/cli.js");
  const runCli = () =>
    promisify(execFile)(process.execPath, [cli], {
      env: { ...process.env, SCABBERS_HOME: directory },
      timeout: 10000,
    });
  let pid: number | undefined;
  try {
    const store = new Store(join(directory, "scabbers.db"));
    const run = store.create("support", "LOCAL:fixture", "codex", "p", {});
    run.sessionId = "preserved-native-session";
    store.save(run);
    store.close();
    const firstPanel = new PanelRuntime(directory, cli, {
      ...process.env,
      SCABBERS_HOME: directory,
    });
    await firstPanel.start();
    const first = JSON.parse((await runCli()).stdout);
    pid = first.pid;
    expect(first.remoteEnabled).toBe(false);
    expect(first.runs).toHaveLength(1);
    const second = JSON.parse((await runCli()).stdout);
    expect(second.pid).toBe(first.pid);
    const waitFor = async (predicate: (status: any) => boolean) => {
      for (let attempt = 0; attempt < 35; attempt++) {
        const status = await request(directory, { action: "status" });
        if (predicate(status)) return status;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Settings reload did not become observable");
    };
    writeFileSync(
      join(directory, "settings.json"),
      JSON.stringify({ workers: 5 }),
    );
    const reloaded = await waitFor((status) => status.workers === 5);
    expect(reloaded.pid).toBe(first.pid);
    expect(reloaded.runs[0].sessionId).toBe("preserved-native-session");
    writeFileSync(join(directory, "settings.json"), "invalid json");
    await waitFor((status) => status.settingsError?.includes("settings.json"));
    writeFileSync(
      join(directory, "settings.json"),
      JSON.stringify({ workers: 2 }),
    );
    await waitFor((status) => status.workers === 2 && !status.settingsError);
    process.kill(first.pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const recoveredPanel = new PanelRuntime(directory, cli, {
      ...process.env,
      SCABBERS_HOME: directory,
    });
    await recoveredPanel.start();
    const recovered = JSON.parse((await runCli()).stdout);
    pid = recovered.pid;
    expect(recovered.pid).not.toBe(first.pid);
    expect(recovered.runs[0].sessionId).toBe("preserved-native-session");
    expect(recovered.runs[0].state).toBe("queued");
    await recoveredPanel.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    pid = undefined;
  } finally {
    if (pid)
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
