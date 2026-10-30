import { it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "../src/storage/store.js";
import { Soul } from "../src/profile/soul.js";
import { reviewSoul } from "../src/profile/review-soul.js";
it("registers skill-generated SOUL in the actual app profile store without approving it, then reviews the same proposal without another model call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-soul-skill-"));
  const input = join(directory, "input.json");
  try {
    writeFileSync(
      input,
      JSON.stringify({
        content:
          "# SOUL\nPrefer editable JSON settings. Preferences never grant permissions.",
        evidence: [
          {
            source: "selected user conversation",
            excerpt: "I prefer a settings.json that I can edit.",
          },
        ],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("skills/scabbers-soul/scripts/propose-soul.ts"),
        "--project",
        process.cwd(),
        "--input",
        input,
        "--state",
        directory,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.status).toBe("pending-review");
    expect(existsSync(output.path)).toBe(true);
    expect(
      existsSync(join(directory, "profiles", output.version, "manifest.json")),
    ).toBe(true);
    const store = new Store(join(directory, "scabbers.db"));
    try {
      expect(store.getSetting("active-profile")).toBeUndefined();
      const soul = new Soul(store, directory);
      expect(soul.latestProposal()?.version).toBe(output.version);
      let displayed = "";
      expect(
        await reviewSoul(
          soul,
          async () => "",
          (text) => {
            displayed += text;
          },
        ),
      ).toBe(false);
      expect(displayed).toContain("Prefer editable JSON");
      expect(store.getSetting("active-profile")).toBeUndefined();
      expect(
        await reviewSoul(
          soul,
          async () => "approve",
          () => {},
        ),
      ).toBe(true);
      expect(store.getSetting("active-profile")).toBe(output.version);
      expect(soul.latestProposal()).toBeUndefined();
      const later = soul.propose("# Changed preference", [
        { source: "human correction", excerpt: "New preference" },
      ]);
      writeFileSync(
        join(directory, "profiles", later, "SOUL.md"),
        "Unregistered edit",
      );
      expect(() => soul.approve(later)).toThrow("artifacts changed");
      expect(store.getSetting("active-profile")).toBe(output.version);
    } finally {
      store.close();
    }
    writeFileSync(
      input,
      JSON.stringify({
        content: "# SOUL",
        evidence: [
          {
            source: "note",
            excerpt: 'access_token="secret-value-not-for-profile"',
          },
        ],
      }),
    );
    const blocked = spawnSync(
      process.execPath,
      [
        resolve("skills/scabbers-soul/scripts/propose-soul.ts"),
        "--project",
        process.cwd(),
        "--input",
        input,
        "--state",
        directory,
      ],
      { encoding: "utf8" },
    );
    expect(blocked.status).not.toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
