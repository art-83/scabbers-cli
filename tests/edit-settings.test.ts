import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editSettings } from "../src/config/edit-settings.js";

it("edits a private draft, retains invalid edits for correction and saves only valid confirmed settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-editor-"));
  const path = join(directory, "settings.json");
  const original = JSON.stringify({
    schedule: {
      zone: "America/Sao_Paulo",
      shifts: [{ day: "Sunday", start: "09:00", end: "18:00" }],
    },
  });
  writeFileSync(path, original);
  let edits = 0;
  try {
    const saved = await editSettings(
      path,
      async (draft) => {
        expect(readFileSync(path, "utf8")).toBe(original);
        if (++edits === 1) writeFileSync(draft, "{invalid");
        else {
          expect(readFileSync(draft, "utf8")).toBe("{invalid");
          const config = JSON.parse(original);
          config.schedule.shifts[0].day = "Friday";
          writeFileSync(draft, JSON.stringify(config));
        }
      },
      async (prompt) => (prompt.startsWith("Valid settings") ? "save" : "edit"),
    );
    expect(saved).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).schedule.shifts[0].day).toBe(
      "Friday",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("preserves discarded edits and concurrent changes and refuses activation through the JSON editor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-editor-"));
  const path = join(directory, "settings.json");
  writeFileSync(path, "{}");
  try {
    expect(
      await editSettings(
        path,
        async (draft) => {
          writeFileSync(draft, '{"workers":8}');
        },
        async () => "discard",
      ),
    ).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("{}");
    expect(
      await editSettings(
        path,
        async (draft) => {
          writeFileSync(draft, '{"remoteEnabled":true}');
        },
        async (prompt) => {
          expect(prompt).toContain("activation review");
          return "discard";
        },
      ),
    ).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("{}");
    await expect(
      editSettings(
        path,
        async (draft) => {
          writeFileSync(draft, '{"workers":8}');
          writeFileSync(path, '{"workers":6}');
        },
        async () => "save",
      ),
    ).rejects.toThrow("changed outside");
    expect(JSON.parse(readFileSync(path, "utf8")).workers).toBe(6);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
