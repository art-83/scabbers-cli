import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepositoryCatalog } from "../src/config/repository-catalog.js";
import { Configuration } from "../src/config/configuration.js";
import { configSchema } from "../src/config/types/config.js";
import { Store } from "../src/storage/store.js";
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((p) => rmSync(p, { recursive: true, force: true })),
);
function root() {
  const path = mkdtempSync(join(tmpdir(), "scabbers-catalog-"));
  directories.push(path);
  return path;
}
function repo(parent: string, name: string) {
  const path = join(parent, name);
  mkdirSync(path, { recursive: true });
  mkdirSync(join(path, ".git"));
  return path;
}
it("discovers supported siblings from a single root without requiring delivery metadata", () => {
  const path = root();
  repo(path, "arcca-pdv");
  repo(path, "arccanet-frontend");
  repo(path, "noah-smart-pos");
  mkdirSync(join(path, "arccanet-backend"));
  const result = new RepositoryCatalog().resolve(
    configSchema.parse({ paths: [path] }),
  );
  expect(result.repositories.map((r) => r.name).sort()).toEqual([
    "arcca-pdv",
    "arccanet-frontend",
  ]);
  expect(result.repositories.every((r) => r.baseBranch === "master")).toBe(
    true,
  );
  expect(
    result.repositories.every(
      (r) => r.testCommand === undefined && r.stagingUrl === undefined,
    ),
  ).toBe(true);
});
it("accepts a direct repository and rejects conflicting duplicate checkouts", () => {
  const a = root(),
    b = root();
  const pdv = repo(a, "arcca-pdv");
  repo(b, "arcca-pdv");
  const catalog = new RepositoryCatalog();
  expect(
    catalog.resolve(configSchema.parse({ paths: [pdv] })).repositories[0]?.path,
  ).toBe(pdv);
  expect(() => catalog.resolve(configSchema.parse({ paths: [a, b] }))).toThrow(
    "Ambiguous",
  );
  expect(() =>
    catalog.resolve(
      configSchema.parse({
        paths: [b],
        repositories: [{ name: "arcca-pdv", path: pdv }],
      }),
    ),
  ).toThrow("conflicts");
});
it("refreshes the effective catalog without persisting discovered entries into settings", () => {
  const path = root(),
    store = new Store(":memory:");
  try {
    const configuration = new Configuration(store, join(path, "settings.json"));
    configuration.save({ paths: [path] });
    repo(path, "arcca-pdv");
    expect(configuration.effective().repositories).toHaveLength(1);
    repo(path, "arccanet-frontend");
    expect(configuration.effective().repositories).toHaveLength(2);
    expect(configuration.get().repositories).toEqual([]);
  } finally {
    store.close();
  }
});
it("preserves explicit metadata and explicit base overrides without crawling nested worktrees", () => {
  const path = root();
  const pdv = repo(path, "arcca-pdv");
  repo(join(path, "worktrees"), "arccanet-frontend");
  const result = new RepositoryCatalog().resolve(
    configSchema.parse({
      paths: [path],
      repositories: [
        {
          name: "arcca-pdv",
          path: pdv,
          baseBranch: "main",
          stagingUrl: "https://staging.example.test",
          testCommand: ["npm", "test"],
        },
      ],
    }),
  );
  expect(result.repositories).toHaveLength(1);
  expect(result.repositories[0]?.baseBranch).toBe("main");
  expect(result.repositories[0]?.testCommand).toEqual(["npm", "test"]);
});
it("rejects missing roots and skips symlinked child checkouts", () => {
  const path = root(),
    target = repo(root(), "arccanet-frontend");
  symlinkSync(target, join(path, "arccanet-frontend"));
  expect(
    new RepositoryCatalog().resolve(configSchema.parse({ paths: [path] }))
      .repositories,
  ).toEqual([]);
  expect(() =>
    new RepositoryCatalog().resolve(
      configSchema.parse({ paths: [join(path, "missing")] }),
    ),
  ).toThrow("does not exist");
});
