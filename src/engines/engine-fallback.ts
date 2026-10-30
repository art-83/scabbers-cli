import type { Config } from "../config/types/config.js";
import type { Store } from "../storage/store.js";
import type { Run } from "../workflows/types/run.js";
import type { EngineHandoff, EngineSessions } from "./types/engine-handoff.js";
export class EngineFallback {
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly now: () => number = Date.now,
  ) {}
  switch(run: Run, fresh: boolean): boolean {
    if (!this.config.fallback.enabled) return false;
    const now = this.now(),
      stage = `${run.state}:${fresh ? "review" : "task"}:${run.data.deliveryAttempt ?? 0}`;
    const cooldowns = (this.store.getSetting("engine-cooldowns") ??
      {}) as Record<string, number>;
    cooldowns[run.engine] = now + this.config.fallback.cooldownSeconds * 1000;
    this.store.setSetting("engine-cooldowns", cooldowns);
    const history = (run.data.engineHandoffs ?? []) as EngineHandoff[];
    const target = this.config.fallback.order.find(
      (engine) =>
        engine !== run.engine &&
        (cooldowns[engine] ?? 0) <= now &&
        !history.some(
          (h) =>
            h.stage === stage &&
            h.from === engine &&
            h.at > now - this.config.fallback.cooldownSeconds * 1000,
        ),
    );
    if (!target) return false;
    const sessions = (run.data.engineSessions ?? {}) as EngineSessions;
    const source = run.engine;
    const sourceSession = fresh
      ? ((run.data.reviewSession as string | undefined) ?? null)
      : run.sessionId;
    sessions[source] = {
      id: run.sessionId,
      options: ((run.data.engineProfiles as Config["engines"] | undefined) ??
        this.config.engines)[source],
    };
    run.engine = target;
    run.sessionId = sessions[target]?.id ?? null;
    if (fresh) delete run.data.reviewSession;
    history.push({
      from: source,
      to: target,
      stage,
      at: now,
      reason: "quota",
      sourceSession,
      targetSession: fresh ? null : run.sessionId,
    });
    run.data.engineHandoffs = history;
    run.data.engineSessions = sessions;
    run.data.inFlight = false;
    delete run.data.inFlightProcess;
    this.store.save(run);
    this.store.log(
      run.id,
      `Usage quota reached: continuing ${run.state} with ${target}; workflow evidence, workspaces and pinned SOUL preserved`,
    );
    return true;
  }
}
