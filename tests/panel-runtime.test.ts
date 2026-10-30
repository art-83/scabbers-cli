import { it, expect } from "vitest";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PanelRuntime } from "../src/runtime/panel-runtime.js";
import { request } from "../src/runtime/client.js";
import { ProcessRunner } from "../src/runtime/process-runner.js";

async function waitUntilStopped(directory: string) {
  for (let i = 0; i < 50; i++) {
    try {
      await request(directory, { action: "status" });
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Panel runtime remained reachable after its owner closed");
}
it("stops the owned runtime when the panel controller closes and rejects a competing panel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-panel-owner-"));
  const owner = new PanelRuntime(directory, resolve("dist/cli.js"), {
    ...process.env,
    SCABBERS_HOME: directory,
  });
  const other = new PanelRuntime(directory, resolve("dist/cli.js"), {
    ...process.env,
    SCABBERS_HOME: directory,
  });
  try {
    await owner.start();
    expect((await request(directory, { action: "status" })).panelOwned).toBe(
      true,
    );
    await expect(other.start()).rejects.toThrow("already running");
    await other.stop();
    expect((await request(directory, { action: "status" })).panelOwned).toBe(
      true,
    );
    await owner.stop();
    await waitUntilStopped(directory);
  } finally {
    await owner.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
it("stops even when the CLI owner is killed without executing cleanup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-panel-crash-")),
    cli = resolve("dist/cli.js");
  const code = `const {spawn}=require('node:child_process');spawn(process.execPath,[${JSON.stringify(cli)},'--daemon'],{stdio:['ignore','ignore','ignore','ipc'],env:process.env});setInterval(()=>{},1000);`;
  const owner = spawn(process.execPath, ["-e", code], {
    stdio: "ignore",
    env: { ...process.env, SCABBERS_HOME: directory },
  });
  let pid: number | undefined;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        pid = (await request(directory, { action: "status" })).pid;
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(pid).toBeTypeOf("number");
    owner.kill("SIGKILL");
    await waitUntilStopped(directory);
  } finally {
    owner.kill("SIGKILL");
    if (pid)
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
it("does not start a runtime from a non-interactive CLI launch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-no-headless-"));
  try {
    const output = await promisify(execFile)(
      process.execPath,
      [resolve("dist/cli.js")],
      { env: { ...process.env, SCABBERS_HOME: directory } },
    );
    expect(JSON.parse(output.stdout).running).toBe(false);
    expect(existsSync(join(directory, "runtime.pid"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("terminates managed subprocesses on runtime shutdown", async () => {
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => (started = resolve));
  let pid = 0;
  const execution = new ProcessRunner().run(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    process.cwd(),
    "",
    undefined,
    undefined,
    10000,
    (child) => {
      pid = child;
      started();
    },
  );
  await ready;
  ProcessRunner.stopAll();
  expect((await execution).code).not.toBe(0);
  expect(() => process.kill(pid, 0)).toThrow();
});

it("tracks SDK-style non-detached native children in the same shutdown registry", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    ProcessRunner.register(child.pid!, false);
    ProcessRunner.stopAll();
    await exited;
    expect(() => process.kill(child.pid!, 0)).toThrow();
  } finally {
    if (child.pid) ProcessRunner.unregister(child.pid);
    child.kill("SIGKILL");
  }
});
