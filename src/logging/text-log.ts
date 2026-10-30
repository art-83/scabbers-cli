import { redactLog } from "./log-redactor.js";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  readSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export const LOG_RETENTION_DAYS = 30;
const DAY = 86400000;
const ownedLog = /^scabbers-(\d{4}-\d{2}-\d{2})\.log$/;

function logDate(name: string): number | undefined {
  const match = ownedLog.exec(name);
  if (!match) return undefined;
  const timestamp = Date.parse(match[1]!);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== match[1]
  )
    return undefined;
  return timestamp;
}

export class TextLog {
  private cleanedDay = "";
  constructor(
    readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {}
  cleanup(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (this.cleanedDay === today) return;
    if (existsSync(this.directory)) {
      if (lstatSync(this.directory).isSymbolicLink())
        throw new Error("Text log directory must not be a symlink");
      const cutoff = Date.parse(today) - (LOG_RETENTION_DAYS - 1) * DAY;
      for (const name of readdirSync(this.directory)) {
        const date = logDate(name);
        if (date === undefined || date >= cutoff) continue;
        const path = join(this.directory, name);
        const stat = lstatSync(path);
        if (stat.isFile() && !stat.isSymbolicLink()) unlinkSync(path);
      }
    }
    this.cleanedDay = today;
  }
  write(message: string, runId: string | null = null): void {
    this.cleanup();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (lstatSync(this.directory).isSymbolicLink())
      throw new Error("Text log directory must not be a symlink");
    chmodSync(this.directory, 0o700);
    const time = new Date(this.now()).toISOString();
    const redacted = redactLog(message);
    const safe =
      redacted.length > 16000
        ? redacted.slice(0, 15900) + "\n[message truncated]"
        : redacted;
    const context = runId
      ? `run=${redactLog(runId).replace(/[\r\n]/g, " ")}`
      : "runtime";
    const text = safe
      .split(/\r?\n/)
      .map((line) => `${time} [${context}] ${line}\n`)
      .join("");
    const path = join(this.directory, `scabbers-${time.slice(0, 10)}.log`);
    const fd = openSync(
      path,
      constants.O_APPEND |
        constants.O_CREAT |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fchmodSync(fd, 0o600);
      appendFileSync(fd, text);
    } finally {
      closeSync(fd);
    }
  }
  tail(limit = 100): string {
    this.cleanup();
    if (!existsSync(this.directory)) return "No text logs recorded yet.";
    const names = readdirSync(this.directory)
      .filter(
        (name) =>
          logDate(name) !== undefined &&
          lstatSync(join(this.directory, name)).isFile(),
      )
      .sort();
    const name = names.at(-1);
    if (!name) return "No text logs recorded yet.";
    const path = join(this.directory, name);
    if (lstatSync(path).isSymbolicLink())
      throw new Error("Text log file must not be a symlink");
    // Logs are already redacted on write; recheck content before terminal output too.
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, 128 * 1024);
      const buffer = Buffer.alloc(length);
      const bytes = readSync(fd, buffer, 0, length, size - length);
      let text = buffer.subarray(0, bytes).toString("utf8");
      if (size > length) text = text.slice(text.indexOf("\n") + 1);
      return redactLog(
        text
          .split("\n")
          .slice(-Math.min(1000, Math.max(1, limit)) - 1)
          .join("\n"),
      );
    } finally {
      closeSync(fd);
    }
  }
}
