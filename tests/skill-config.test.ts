import { it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
it("generates importable Brazilian defaults, preserves explicit Sunday/Codex choices and refuses secrets/overwrites", () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-skill-"));
  const script = resolve(
    "skills/scabbers-configure/scripts/generate-config.ts",
  );
  const input = join(directory, "input.json");
  const run = (config: unknown, name: string) => {
    writeFileSync(
      input,
      JSON.stringify({ config, evidence: [], unresolved: [] }),
    );
    return spawnSync(
      process.execPath,
      [
        script,
        "--project",
        process.cwd(),
        "--discovery",
        input,
        "--output",
        join(directory, name),
      ],
      { encoding: "utf8" },
    );
  };
  try {
    expect(run({}, "default.json").status).toBe(0);
    const defaults = JSON.parse(
      readFileSync(join(directory, "default.json"), "utf8"),
    );
    expect(defaults.schedule).toEqual({
      zone: "America/Sao_Paulo",
      shifts: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(
        (day) => ({ day, start: "09:00", end: "18:00" }),
      ),
    });
    expect(defaults.remoteEnabled).toBe(false);
    expect(defaults.workers).toBe(3);
    expect(statSync(join(directory, "default.json")).mode & 0o777).toBe(0o600);
    const report = JSON.parse(
      readFileSync(join(directory, "default.json.discovery.json"), "utf8"),
    );
    expect(report.scheduleDisplay.shifts[0].start).toBe("9:00 AM");
    expect(report.scheduleDisplay.shifts[0].end).toBe("6:00 PM");
    expect(report.unresolved.length).toBeGreaterThan(0);
    expect(
      run(
        {
          engine: "codex",
          schedule: {
            shifts: [{ day: "Sunday", start: "09:00", end: "18:00" }],
          },
          remoteEnabled: true,
        },
        "personal.json",
      ).status,
    ).toBe(0);
    const personal = JSON.parse(
      readFileSync(join(directory, "personal.json"), "utf8"),
    );
    expect(personal.schedule.shifts[0].day).toBe("Sunday");
    expect(personal.engine).toBe("codex");
    expect(personal.remoteEnabled).toBe(false);
    expect(run({}, "personal.json").status).not.toBe(0);
    expect(run({ schedule: { start: "" } }, "invalid.json").status).not.toBe(0);
    expect(existsSync(join(directory, "invalid.json"))).toBe(false);
    expect(
      run({ slack: { token: "a-secret-value" } }, "secret.json").status,
    ).not.toBe(0);
    expect(existsSync(join(directory, "secret.json"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
