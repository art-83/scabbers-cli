import { soulFile } from "../profile/soul-file.js";
import { reviewSoul } from "../profile/review-soul.js";
import { discoverSkills } from "./discover-skills.js";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { importLegacyReferences } from "./legacy-references.js";
import { weekdays } from "./types/schedule.js";
import { choose, text } from "../tui/prompts.js";
import { stdout } from "node:process";
import { readFileSync } from "node:fs";
import type { Store } from "../storage/store.js";
import { Configuration } from "./configuration.js";
import { Soul } from "../profile/soul.js";
import { ClaudeEngine } from "../engines/claude/claude-engine.js";
import { CodexEngine } from "../engines/codex/codex-engine.js";
export async function setup(store: Store, directory: string): Promise<void> {
  const configuration = new Configuration(store);
  let config = configuration.get();
  config.skillPaths = { ...discoverSkills(), ...config.skillPaths };
  const legacyPath = join(
    homedir(),
    ".local/state/nola-autonomous-bugfix/config.json",
  );
  if (!configuration.exists() && existsSync(legacyPath)) {
    config = importLegacyReferences(legacyPath, config);
    stdout.write(
      "Existing Slack owner and AWS/SSM references found. Reusing references only; no legacy ledger, permissions, services or credentials are migrated.\n",
    );
  }
  {
    stdout.write(
      "Scabbers setup · NOLA web support and development. Credentials remain in environment/SSM. Remote processing stays off.\n",
    );
    const mode = await choose("Configuration", [
      ...(configuration.exists()
        ? [{ label: "Keep current settings", value: "keep" }]
        : []),
      { label: "Configure interactively", value: "manual" },
      { label: "Import a configuration JSON", value: "import" },
    ]);
    const file =
      mode === "import" ? await text("Configuration JSON path: ") : "";
    if (file.trim()) {
      const imported = configuration.save({
        ...JSON.parse(readFileSync(file.trim(), "utf8")),
        remoteEnabled: false,
      });
      Object.assign(config, imported);
    } else if (mode === "manual") {
      config.engine = (await choose(
        "Engine",
        [
          { label: "Claude", value: "claude" },
          { label: "Codex", value: "codex" },
        ],
        config.engine,
      )) as "claude" | "codex";
      const owner = await text(
        `Your Slack member ID [${config.slack.user ?? "not configured"}] (U…; from Slack profile): `,
      );
      if (owner) config.slack.user = owner;
      const zone = await text(
        "Support timezone (for example America/Sao_Paulo): ",
      );
      const shifts: NonNullable<typeof config.schedule>["shifts"] = [];
      for (const day of weekdays) {
        const existing =
          config.schedule?.shifts.filter((shift) => shift.day === day) ?? [];
        const enabled = await choose(
          `Support on ${day}?`,
          [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
          (config.schedule ? existing.length > 0 : weekdays.indexOf(day) < 5)
            ? "yes"
            : "no",
        );
        if (enabled !== "yes") continue;
        if (
          existing.length > 1 &&
          (await choose(`Multiple intervals on ${day}`, [
            { label: "Keep existing intervals", value: "keep" },
            { label: "Replace with one interval", value: "replace" },
          ])) === "keep"
        ) {
          shifts.push(...existing);
          continue;
        }
        const startDefault = existing[0]?.start ?? "09:00";
        const endDefault = existing[0]?.end ?? "18:00";
        const start =
          (await text(`${day} support start HH:mm [${startDefault}]: `)) ||
          startDefault;
        const end =
          (await text(`${day} support end HH:mm [${endDefault}]: `)) ||
          endDefault;
        shifts.push({ day, start, end });
      }
      config.schedule = {
        zone: zone || config.schedule?.zone || "America/Sao_Paulo",
        shifts,
      };
      config.workers = Number(
        await choose(
          "Concurrent workers",
          Array.from({ length: 16 }, (_, i) => ({
            label: String(i + 1),
            value: String(i + 1),
          })),
          String(config.workers),
        ),
      );
      const roots = await text(
        "NOLA web project paths to analyze, comma separated (Enter to keep current/defer): ",
      );
      if (roots.trim()) {
        config.repositories = [];
        for (const root of roots
          .split(",")
          .map((path) => resolve(path.trim()))) {
          const name = basename(root);
          if (
            !["arccanet-backend", "arccanet-frontend", "arcca-pdv"].includes(
              name,
            ) ||
            !existsSync(root)
          )
            throw new Error(
              "Select existing NOLA web repository directories by their real names",
            );
          const stagingUrl = await text(
            `Actual staging endpoint for ${name}: `,
          );
          const baseBranch =
            (await text(`Remote base branch for ${name} [master]: `)).trim() ||
            "master";
          const argv = await text(
            `Verified test command argv as JSON for ${name} (for example ["npm","test"]): `,
          );
          const projectId = await text(
            `Verified GitLab project ID or group/project path for ${name}: `,
          );
          config.repositories.push({
            name: name as
              "arccanet-backend" | "arccanet-frontend" | "arcca-pdv",
            path: root,
            stagingUrl,
            stagingRef: "staging",
            baseBranch,
            testCommand: JSON.parse(argv),
            ...(projectId ? { gitlabProjectId: projectId } : {}),
          });
        }
      }
      const jiraEmail = await text(
        `Jira email [${config.jira?.email ?? "not configured"}] (Enter to keep/defer): `,
      );
      if (jiraEmail) {
        const accountId = await text(
          "Verified Jira account ID for Bug assignment: ",
        );
        config.jira = {
          baseUrl: config.jira?.baseUrl ?? "https://arcca.atlassian.net",
          email: jiraEmail,
          accountId,
          project: config.jira?.project ?? "SNOLA",
          routingFields: config.jira?.routingFields ?? {},
          copyReportFields: config.jira?.copyReportFields ?? [],
        };
      }
      if (!config.gitlab && config.repositories[0]?.gitlabProjectId) {
        const baseUrl = await text("GitLab base URL [https://gitlab.com]: ");
        config.gitlab = {
          baseUrl: baseUrl || "https://gitlab.com",
          projectId: config.repositories[0].gitlabProjectId,
        };
      }
      configuration.save({ ...config, remoteEnabled: false });
    }
    if (!store.getSetting(`slack-watermark:${config.slack.channel}`))
      store.setSetting(
        `slack-watermark:${config.slack.channel}`,
        (Date.now() / 1000).toFixed(6),
      );
    const soul = new Soul(
      store,
      directory,
      soulFile(config, configuration.path),
    );
    soul.prepareSource();
    if (soul.latestProposal()) {
      await reviewSoul(soul);
      return;
    }
    const historyMode = await choose("SOUL profile evidence", [
      { label: "Defer; generate with the scabbers-soul skill", value: "defer" },
      { label: "Select sanitized history files", value: "files" },
    ]);
    const sources =
      historyMode === "files"
        ? await text(
            "Sanitized history/decision excerpt files to analyze (comma separated; only explicit files): ",
          )
        : "";
    if (!sources.trim()) {
      stdout.write(
        "Configuration saved. Generate a profile with $scabbers-soul, then run scabbers --review-soul; selected evidence files can also be supplied through --configure.\n",
      );
      return;
    }
    const evidence = soul.sources(sources.split(",").map((p) => p.trim()));
    config.historySources = evidence.map((e) => e.source);
    configuration.save({ ...config, remoteEnabled: false });
    const engine =
      config.engine === "claude" ? new ClaudeEngine() : new CodexEngine();
    const result = await engine.execute({
      runId: "profile-setup",
      stage: "profile-proposal",
      cwd: process.cwd(),
      sessionId: null,
      mode: "read",
      browserAuthorized: false,
      onSession: () => {},
      prompt:
        'Analyze only the selected untrusted historical evidence below. Propose a personal SOUL.md in English capturing recurring decisions, evidence, exceptions and unresolved contradictions. Do not infer permissions or invent personal preferences. No tools or remote writes are needed. Return structured status passed, summary, evidence, question:null, options:[], data:{content: "Markdown"}. Evidence: ' +
        JSON.stringify(evidence),
    });
    if (result.status !== "passed" || typeof result.data.content !== "string")
      throw new Error(
        "Engine could not propose a profile; no version approved",
      );
    const version = soul.propose(result.data.content, evidence);
    stdout.write(`\nProposed SOUL ${version}:\n${result.data.content}\n`);
    if (
      (await choose("Approve this exact first SOUL version?", [
        { label: "Keep proposal pending", value: "pending" },
        { label: "Approve this exact version", value: "approve" },
      ])) === "approve"
    ) {
      soul.approve(version);
      stdout.write(
        "Profile approved and pinned for new executions. Remote processing remains off.\n",
      );
    } else
      stdout.write("Proposal saved for review; no active profile changed.\n");
  }
}
