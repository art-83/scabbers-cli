import { it, expect, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureSetting,
  settingsItems,
} from "../src/config/settings-menu.js";
import { Configuration } from "../src/config/configuration.js";
import { Store } from "../src/storage/store.js";
import { CredentialStore } from "../src/integrations/credential-store.js";
import { Secrets } from "../src/integrations/secrets.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "scabbers-settings-menu-"));
  const path = join(directory, "settings.json");
  const store = new Store(":memory:");
  const settings = new Configuration(store, path);
  settings.save({
    engine: "codex",
    schedule: {
      zone: "America/Sao_Paulo",
      shifts: [{ day: "Friday", start: "09:00", end: "18:00" }],
    },
    jira: {
      baseUrl: "https://jira.example.com",
      email: "fixture@example.com",
      accountId: "fixture",
      project: "SNOLA",
    },
  });
  const credentials = new CredentialStore(directory);
  const clean = () => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return { directory, path, settings, credentials, clean };
}

it("saves hidden integration tokens separately, persists across new resolvers, rotates and removes them without changing automation", async () => {
  const f = fixture();
  try {
    let answers = ["token", "done", "save"];
    const prompts = {
      choose: vi.fn(async () => answers.shift()!),
      text: vi.fn(async () => ""),
      secret: vi.fn(async () => "fixture-private-token-one"),
    };
    expect(await configureSetting(f.path, "jira", prompts, f.credentials)).toBe(
      true,
    );
    const first = f.settings.get();
    const reference = first.credentialKeys.SCABBERS_JIRA_TOKEN!;
    expect(readFileSync(f.path, "utf8")).not.toContain("fixture-private-token");
    expect(statSync(join(f.directory, "credentials.json")).mode & 0o777).toBe(
      0o600,
    );
    expect(
      await new Secrets({}, first.credentialKeys, f.directory).get(
        "SCABBERS_JIRA_TOKEN",
      ),
    ).toBe("fixture-private-token-one");
    expect(first.remoteEnabled).toBe(false);
    expect(JSON.stringify(settingsItems(f.path))).not.toContain(
      "fixture-private-token",
    );
    answers = ["token", "done", "save"];
    prompts.secret.mockResolvedValue("fixture-private-token-two");
    await configureSetting(f.path, "jira", prompts, f.credentials);
    expect(() => f.credentials.get(reference)).toThrow("unavailable");
    const second = f.settings.get();
    expect(
      await new Secrets({}, second.credentialKeys, f.directory).get(
        "SCABBERS_JIRA_TOKEN",
      ),
    ).toBe("fixture-private-token-two");
    expect(JSON.stringify(prompts.choose.mock.calls)).not.toContain(
      "fixture-private-token",
    );
    answers = ["remove", "done", "save"];
    await configureSetting(f.path, "jira", prompts, f.credentials);
    expect(f.settings.get().credentialKeys.SCABBERS_JIRA_TOKEN).toBeUndefined();
    expect(
      readFileSync(join(f.directory, "credentials.json"), "utf8"),
    ).not.toContain("fixture-private-token");
  } finally {
    f.clean();
  }
});

it("discards tokens without writing them and preserves newer settings instead of overwriting a concurrent edit", async () => {
  const f = fixture();
  try {
    const original = readFileSync(f.path, "utf8");
    let answers = ["token", "done", "discard"];
    const prompts = {
      choose: async () => answers.shift()!,
      text: async () => "",
      secret: async () => "fixture-discarded-token",
    };
    expect(await configureSetting(f.path, "jira", prompts, f.credentials)).toBe(
      false,
    );
    expect(readFileSync(f.path, "utf8")).toBe(original);
    expect(existsSync(join(f.directory, "credentials.json"))).toBe(false);
    answers = ["token", "done", "save"];
    prompts.secret = async () => {
      writeFileSync(f.path, '{"workers":6}');
      return "fixture-discarded-token";
    };
    await expect(
      configureSetting(f.path, "jira", prompts, f.credentials),
    ).rejects.toThrow("changed outside");
    expect(f.settings.get().workers).toBe(6);
    expect(existsSync(join(f.directory, "credentials.json"))).toBe(false);
  } finally {
    f.clean();
  }
});

it("edits named days and individual support hours through menus while rejecting invalid intervals before saving", async () => {
  const f = fixture();
  try {
    let answers = ["0", "edit", "Monday", "done", "save"];
    let values = ["08:00", "12:00"];
    const prompts = {
      choose: async () => answers.shift()!,
      text: async () => values.shift()!,
      secret: async () => "",
    };
    await configureSetting(f.path, "schedule", prompts, f.credentials);
    expect(f.settings.get().schedule?.shifts).toEqual([
      { day: "Monday", start: "08:00", end: "12:00" },
    ]);
    const original = readFileSync(f.path, "utf8");
    answers = ["0", "edit", "Friday", "done", "save"];
    values = ["invalid", "20:00"];
    await expect(
      configureSetting(f.path, "schedule", prompts, f.credentials),
    ).rejects.toThrow("schedule");
    expect(readFileSync(f.path, "utf8")).toBe(original);
  } finally {
    f.clean();
  }
});
