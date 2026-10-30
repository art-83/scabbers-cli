import { redactLog } from "../src/logging/log-redactor.js";
import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  symlinkSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { TextLog } from "../src/logging/text-log.js";
import { Store } from "../src/storage/store.js";
import { ProcessRunner } from "../src/runtime/process-runner.js";

it("writes private chronological plaintext and SQLite records with redacted secrets and execution identity", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-text-log-"));
  const store = new Store(join(root, "state.db"));
  try {
    const token = ["xoxb", "1234567890".repeat(3)].join("-");
    store.log(
      "run-fixture",
      `Starting stage\nAuthorization: Bearer ${token}\npassword="${"secret".repeat(5)}"\n\x1b[31mFailed assertion\x1b[0m`,
    );
    const text = store.textLog!.tail();
    expect(text).toContain("[run=run-fixture] Starting stage");
    expect(text).toContain("Failed assertion");
    expect(text).not.toContain(token);
    expect(text).not.toContain("secret".repeat(5));
    expect(text).not.toContain("\x1b");
    expect(store.logs("run-fixture")[0]).toContain("[REDACTED");
    expect(statSync(join(root, "logs")).mode & 0o777).toBe(0o700);
    const file = join(
      root,
      "logs",
      `scabbers-${new Date().toISOString().slice(0, 10)}.log`,
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(
      text
        .trim()
        .split("\n")
        .every((line) => /^\d{4}-.*Z \[run=run-fixture\]/.test(line)),
    ).toBe(true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("rotates by day and removes only owned regular logs outside the 30-day window", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-log-retention-"));
  let now = Date.parse("2026-10-30T12:00:00Z");
  const logs = join(root, "logs");
  mkdirSync(logs);
  const log = new TextLog(logs, () => now);
  try {
    writeFileSync(join(logs, "scabbers-2026-09-30.log"), "expired");
    writeFileSync(join(logs, "scabbers-2026-10-01.log"), "retain");
    writeFileSync(
      join(logs, "scabbers-2026-99-99.log"),
      "invalid date, not owned",
    );
    writeFileSync(join(logs, "notes.txt"), "user notes");
    const external = join(root, "external.txt");
    writeFileSync(external, "preserve");
    symlinkSync(external, join(logs, "scabbers-2026-09-29.log"));
    log.write("first day");
    expect(existsSync(join(logs, "scabbers-2026-09-30.log"))).toBe(false);
    expect(existsSync(join(logs, "scabbers-2026-10-01.log"))).toBe(true);
    expect(readFileSync(external, "utf8")).toBe("preserve");
    expect(existsSync(join(logs, "notes.txt"))).toBe(true);
    expect(existsSync(join(logs, "scabbers-2026-99-99.log"))).toBe(true);
    now = Date.parse("2026-11-01T12:00:00Z");
    log.write("second day");
    expect(existsSync(join(logs, "scabbers-2026-10-01.log"))).toBe(false);
    expect(existsSync(join(logs, "scabbers-2026-10-30.log"))).toBe(true);
    expect(
      readFileSync(join(logs, "scabbers-2026-11-01.log"), "utf8"),
    ).toContain("second day");
    expect(log.tail()).toContain("second day");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("keeps SQLite logs and reports text sink failures, then recovers without changing execution state", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-log-failure-"));
  writeFileSync(join(root, "logs"), "This is not a directory");
  const store = new Store(join(root, "state.db"));
  try {
    store.log("fixture", "Useful failure evidence");
    expect(store.loggingError).toContain("Cannot write text logs");
    expect(store.logs("fixture")).toEqual(["Useful failure evidence"]);
    unlinkSync(join(root, "logs"));
    store.log("fixture", "Recovered sink");
    expect(store.loggingError).toBeNull();
    expect(store.textLog!.tail()).toContain("Recovered sink");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("cleans old SQLite diagnostic rows without deleting runs or profile records", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-db-retention-"));
  let db = new Store(join(root, "state.db"));
  try {
    db.create("support", "source", "codex", "profile", {});
    db.db
      .prepare("INSERT INTO logs(runId,at,message) VALUES(?,?,?)")
      .run(null, Date.now() - 31 * 86400000, "expired diagnostic");
    db.db
      .prepare("INSERT INTO profiles VALUES(?,?,?,?,?)")
      .run("profile", "content", "[]", 1, 1);
    db.close();
    db = new Store(join(root, "state.db"));
    expect(db.logs(null)).not.toContain("expired diagnostic");
    expect(db.list()).toHaveLength(1);
    expect(db.db.prepare("SELECT count(*) AS n FROM profiles").get()?.n).toBe(
      1,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("captures process stderr including its final unterminated line", async () => {
  const stdout: string[] = [],
    stderr: string[] = [];
  const result = await new ProcessRunner().run(
    process.execPath,
    [
      "-e",
      'process.stdout.write("ok\\n");process.stderr.write("useful failure detail")',
    ],
    process.cwd(),
    "",
    (line) => stdout.push(line),
    undefined,
    undefined,
    undefined,
    undefined,
    (line) => stderr.push(line),
  );
  expect(result.code).toBe(0);
  expect(stdout).toEqual(["ok"]);
  expect(stderr).toEqual(["useful failure detail"]);
});

it("views text logs through the actual CLI without starting a daemon or requiring settings", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-log-viewer-"));
  try {
    new TextLog(join(root, "logs")).write("Saved diagnostic fixture");
    const output = execFileSync(process.execPath, ["dist/cli.js", "--logs"], {
      encoding: "utf8",
      env: {
        ...process.env,
        SCABBERS_HOME: root,
        SCABBERS_SETTINGS: join(root, "missing-settings.json"),
      },
    });
    expect(output).toContain("Saved diagnostic fixture");
    expect(existsSync(join(root, "runtime.pid"))).toBe(false);
    expect(existsSync(join(root, "runtime.sock"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("redacts private keys, URL credentials and bounds large individual messages", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-log-bounds-"));
  try {
    const key = [
      ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
      "not-a-real-key",
      ["-----END", "PRIVATE KEY-----"].join(" "),
    ].join("\n");
    expect(redactLog(key)).not.toContain("not-a-real-key");
    expect(redactLog("https://user:pass@example.invalid/path")).not.toContain(
      "user:pass",
    );
    const log = new TextLog(root);
    log.write("a".repeat(50000));
    const tail = log.tail();
    expect(tail).toContain("[message truncated]");
    expect(tail.length).toBeLessThan(17000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("redacts private keys split across diagnostic messages without hiding another execution", () => {
  const root = mkdtempSync(join(tmpdir(), "scabbers-stream-redaction-"));
  const store = new Store(join(root, "state.db"));
  try {
    store.log("key-output", ["-----BEGIN", "PRIVATE KEY-----"].join(" "));
    store.log("key-output", "encoded-private-material");
    store.log("other-run", "Independent useful diagnostic");
    store.log("key-output", ["-----END", "PRIVATE KEY-----"].join(" "));
    store.log("key-output", "Safe output resumes");
    const text = store.textLog!.tail();
    expect(text).not.toContain("encoded-private-material");
    expect(text).toContain("Independent useful diagnostic");
    expect(text).toContain("Safe output resumes");
    expect(store.logs("key-output").join("\n")).not.toContain(
      "encoded-private-material",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
