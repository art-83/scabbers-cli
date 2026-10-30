import { AssigneePolicy } from "./assignee-policy.js";
import { EngineeringWorkflow } from "../development/engineering-workflow.js";
import type { Family } from "./types/family.js";
import { createHash, randomUUID } from "node:crypto";
import type { Config } from "../config/types/config.js";
import type { Store } from "../storage/store.js";
import type { IssueTracker } from "../integrations/abstractions/interface/issue-tracker.js";
import type { ProfileSnapshot } from "../profile/types/profile-snapshot.js";
import { Hierarchy } from "./hierarchy.js";
import { JiraCard } from "./jira-card.js";
import { FamilyPolicy } from "./family-policy.js";

import type { IntakePreview } from "./types/intake-preview.js";
export class FeatureIntake {
  private stopping = false;
  stop(): void {
    this.stopping = true;
  }
  static configuration(config: Config): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          site: config.jira?.baseUrl,
          board: config.development.boardId,
          column: config.development.column,
          workflowStatuses: config.development.workflowStatuses,
          accountId: config.jira?.accountId,
          policy: "mandatory-assignee-scope-v3",
        }),
      )
      .digest("hex");
  }

  private readonly hierarchy: Hierarchy;
  private readonly assignee: AssigneePolicy;
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly jira: IssueTracker,
    private readonly profile?: () => ProfileSnapshot,
  ) {
    this.hierarchy = new Hierarchy(jira);
    this.assignee = new AssigneePolicy(config.jira?.accountId);
  }
  async advance(
    previewOnly = true,
    steps = 20,
    restart = false,
  ): Promise<IntakePreview> {
    const owner = randomUUID();
    if (!this.store.acquire("development-discovery", owner))
      throw new Error(
        "Development discovery is already running; inspect its saved progress",
      );
    try {
      return await this.performAdvance(previewOnly, steps, restart);
    } finally {
      this.store.release(owner);
    }
  }
  private async performAdvance(
    previewOnly = true,
    steps = 20,
    restart = false,
  ): Promise<IntakePreview> {
    const key = previewOnly ? "development-preview" : "development-scan";
    const fingerprint = FeatureIntake.configuration(this.config);
    if (!previewOnly) {
      const preview = this.store.getSetting("development-preview") as
        IntakePreview | undefined;
      if (
        preview?.status !== "complete" ||
        preview.configuration !== fingerprint
      )
        throw new Error(
          "Complete the read-only Development preview before automatic intake",
        );
    }
    let state = this.store.getSetting(key) as IntakePreview | undefined;
    if (
      !state ||
      restart ||
      state.configuration !== fingerprint ||
      (!previewOnly && state.status === "complete")
    )
      state = {
        configuration: fingerprint,
        status: "discovering",
        tokens: [],
        lastPage: false,
        pending: [],
        families: [],
        excluded: [],
        checkedAt: Date.now(),
      };
    if (state.status === "complete") return state;
    state.status = "discovering";
    delete state.error;
    const save = () => {
      state!.checkedAt = Date.now();
      this.store.setSetting(key, state);
    };
    try {
      for (let step = 0; step < steps; step++) {
        if (this.stopping) break;
        if (!this.jira.board || !this.jira.searchPage)
          throw new Error("Jira board/search capabilities unavailable");
        if (!state.board) {
          state.board = await this.jira.board(
            this.config.development.boardId,
            this.config.development.column,
          );
          if (
            !/^\d+$/.test(state.board.filterId) ||
            !state.board.statusIds.length ||
            state.board.statusIds.some((id) => !/^\d+$/.test(id))
          )
            throw new Error("Invalid board metadata");
          state.jql = `filter = ${state.board.filterId} AND status IN (${state.board.statusIds.join(", ")}) AND assignee = ${JSON.stringify(this.assignee.accountId)} ORDER BY priority DESC, key ASC`;
        } else if (state.discovery) {
          try {
            await this.hierarchy.step(state.discovery);
          } catch (error) {
            const reason =
              error instanceof Error
                ? error.message
                : "Family discovery failed";
            state.blockedDiscoveries ??= [];
            state.blockedDiscoveries.push({
              state: structuredClone(state.discovery),
              error: reason,
            });
            state.excluded.push({ key: state.discovery.seed, reason });
            this.store.log(
              null,
              `Development family ${state.discovery.seed} blocked: ${reason}`,
            );
            delete state.discovery;
            save();
            continue;
          }
          if (state.discovery.complete) {
            const family = this.hierarchy.complete(state.discovery);
            if (!state.families.some((f) => f.root === family.root))
              state.families.push(family);
            const blocker = new FamilyPolicy(
              new EngineeringWorkflow(this.config.development.workflowStatuses),
            ).blocker(
              family,
              [],
              family.members
                .filter((i) => this.assignee.owns(i))
                .map((i) => i.key),
            );
            if (blocker)
              state.excluded.push({ key: family.root, reason: blocker });
            else if (!previewOnly && !this.stopping) this.enqueue(family);
            delete state.discovery;
          }
        } else if (state.pending.length) {
          const seed = state.pending[0]!;
          if (
            !state.families.some((f) => f.members.some((i) => i.key === seed))
          )
            state.discovery = this.hierarchy.create(seed);
          state.pending.shift();
        } else if (!state.lastPage) {
          const page = await this.jira.searchPage(state.jql!, state.token);
          for (const issue of page.issues) {
            if (new JiraCard(issue).isFeature && this.assignee.owns(issue))
              state.pending.push(issue.key);
            else
              state.excluded.push({
                key: issue.key,
                reason: !this.assignee.owns(issue)
                  ? "Not assigned to the configured Jira owner"
                  : `Not a feature type: ${issue.fields.issuetype.name}`,
              });
          }
          state.lastPage = page.isLast;
          if (!page.isLast) {
            if (
              !page.nextPageToken ||
              state.tokens.includes(page.nextPageToken)
            )
              throw new Error("Board pagination stalled");
            state.tokens.push(page.nextPageToken);
            state.token = page.nextPageToken;
          }
        } else {
          state.status = "complete";
          save();
          break;
        }
        save();
      }
      this.store.log(
        null,
        `Development ${previewOnly ? "preview" : "intake"}: ${state.status}; ${state.families.length} complete families; ${state.pending.length} candidates pending; ${state.excluded.length} exclusions`,
      );
    } catch (error) {
      state.status = "blocked";
      state.error =
        error instanceof Error ? error.message : "Jira family discovery failed";
      save();
      this.store.log(null, `Development discovery blocked: ${state.error}`);
    }
    return state;
  }
  private enqueue(family: Family): void {
    if (!this.profile)
      throw new Error("Approved SOUL required for Development intake");
    const snapshot = this.profile();
    this.store.transaction(() => {
      const runs = this.store.list();
      const active = runs.filter(
        (r) => !["done", "handoff", "cancelled"].includes(r.state),
      );
      const overlap = active.find((r) => {
        const previous = r.data.family as Family | undefined;
        return (
          previous?.root === family.root ||
          family.members.some(
            (i) =>
              i.key === r.data.issueKey ||
              previous?.members.some((m) => m.key === i.key),
          )
        );
      });
      if (overlap) {
        const previous = overlap.data.family as Family | undefined;
        if (previous && previous.digest !== family.digest) {
          overlap.data.scopeChanged = true;
          overlap.error =
            "Jira family requirements/membership changed; scope revalidation required";
          this.store.save(overlap);
        }
        return;
      }
      if (
        runs.some(
          (r) =>
            (r.data.family as Family | undefined)?.digest === family.digest &&
            (r.data.family as Family).root === family.root,
        )
      )
        return;
      const root = family.members.find((i) => i.key === family.root)!;
      const scope = family.members
        .filter(
          (i) =>
            this.assignee.owns(i) &&
            !new JiraCard(i).isDone &&
            !new JiraCard(i).isEpic &&
            new EngineeringWorkflow(
              this.config.development.workflowStatuses,
            ).includes(i.fields.status!.name),
        )
        .map((i) => i.key);
      if (!scope.length) {
        this.store.log(
          null,
          `Development family ${family.root} has no engineering work inside the approved workflow`,
        );
        return;
      }
      const run = this.store.create(
        "feature",
        `${family.root}@${family.digest.slice(0, 16)}`,
        this.config.engine,
        snapshot.version,
        {
          issueKey: family.root,
          issue: root,
          family,
          scopeMembers: scope,
          scopePending: true,
          soulSnapshot: snapshot,
          ownerSlackUser: this.config.slack.user,
        },
      );
      run.data.branchName = `codex/scabbers-${family.root.toLowerCase()}-${run.id.slice(0, 8)}`;
      this.store.save(run);
    });
  }
}
