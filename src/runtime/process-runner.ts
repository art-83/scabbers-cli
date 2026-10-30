import { spawn } from "node:child_process";
export class ProcessRunner {
  run(
    command: string,
    args: string[],
    cwd: string,
    input = "",
    onLine: (line: string) => void = () => {},
    signal?: AbortSignal,
    timeout = 600_000,
    onProcess?: (pid: number) => void,
    environment: NodeJS.ProcessEnv = process.env,
    onStderr?: (line: string) => void,
  ): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: environment,
        detached: true,
      });
      let stdout = "",
        buffer = "",
        stderrBuffer = "",
        bytes = 0,
        settled = false;
      let failure: string | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      child.once("spawn", () => {
        try {
          if (child.pid) onProcess?.(child.pid);
        } catch {
          fail("Could not persist native process checkpoint");
        }
      });
      const kill = () => {
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {}
      };
      const fail = (message: string) => {
        if (!settled && !failure) {
          failure = message;
          kill();
          killTimer = setTimeout(() => {
            try {
              process.kill(-child.pid!, "SIGKILL");
            } catch {}
          }, 2000);
          killTimer.unref();
        }
      };
      const timer = setTimeout(
        () =>
          fail("Process deadline exceeded; inspect saved session before retry"),
        timeout,
      );
      const abort = () => fail("Execution interrupted");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8_000_000) {
          fail("Process output limit exceeded");
          return;
        }
        stdout += chunk.toString();
        buffer += chunk.toString();
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          try {
            onLine(line);
          } catch {
            fail("Invalid engine session protocol");
          }
        }
      });
      const emitErrorLine = (line: string) => {
        try {
          onStderr?.(line.slice(0, 16000));
        } catch {
          fail("Cannot record process diagnostics");
        }
      };
      child.stderr.on("data", (chunk: Buffer) => {
        if (!onStderr) return;
        bytes += chunk.length;
        if (bytes > 8_000_000) {
          fail("Process output limit exceeded");
          return;
        }
        stderrBuffer += chunk.toString();
        let index;
        while ((index = stderrBuffer.indexOf("\n")) >= 0) {
          emitErrorLine(stderrBuffer.slice(0, index));
          stderrBuffer = stderrBuffer.slice(index + 1);
        }
        if (stderrBuffer.length > 16000) {
          emitErrorLine(stderrBuffer);
          stderrBuffer = "";
        }
      });
      child.on("error", () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error(`Cannot start ${command}; run setup diagnostics`));
        }
      });
      child.on("close", (code) => {
        if (stderrBuffer) emitErrorLine(stderrBuffer);
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
        if (!settled) {
          settled = true;
          if (failure) reject(new Error(failure));
          else resolve({ stdout, code: code ?? 1 });
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
}
