import type { Store } from "../storage/store.js";
import type { Run } from "../workflows/types/run.js";
export class WorkerPool {
  private readonly active = new Map<string, AbortController>();
  constructor(
    private readonly store: Store,
    private readonly limit: number,
    private readonly step: (run: Run, signal: AbortSignal) => Promise<void>,
    private readonly onFailure?: (run: Run, message: string) => Promise<string>,
  ) {}
  get activeCount(): number {
    return this.active.size;
  }
  async tick(): Promise<void> {
    for (const run of this.store.list()) {
      if (this.active.size >= this.limit) break;
      const blocker = run.data.blockerDecision
        ? this.store.db
            .prepare("SELECT * FROM decisions WHERE id=?")
            .get(String(run.data.blockerDecision))
        : undefined;
      if (
        run.error &&
        blocker?.status === "answered" &&
        blocker.answer === "Retry checkpoint"
      ) {
        run.error = null;
        delete run.data.blockerDecision;
        this.store.save(run);
      }
      if (
        run.paused ||
        run.error ||
        ["done", "handoff", "cancelled"].includes(run.state) ||
        this.active.has(run.id)
      )
        continue;
      const decisions = this.store.db
        .prepare(
          "SELECT status FROM decisions WHERE runId=? ORDER BY createdAt DESC LIMIT 1",
        )
        .get(run.id);
      if (decisions?.status === "pending") continue;
      const resource = String(run.data.worktree ?? run.source);
      if (!this.store.acquire(resource, run.id)) continue;
      const controller = new AbortController();
      this.active.set(run.id, controller);
      this.store.log(run.id, `${run.kind} · ${run.state}: worker started`);
      void this.step(run, controller.signal)
        .catch(async (error) => {
          const current = this.store.get(run.id);
          if (current.state !== "cancelled") {
            current.error =
              error instanceof Error ? error.message : "Stage failed";
            this.store.save(current);
            this.store.log(
              run.id,
              error instanceof Error
                ? (error.stack ?? current.error!)
                : current.error!,
            );
            if (!current.paused && this.onFailure) {
              try {
                current.data.blockerDecision = await this.onFailure(
                  current,
                  current.error!,
                );
                this.store.save(current);
              } catch {
                this.store.log(
                  run.id,
                  "Private blocker notification unavailable; reconnect Slack and resume this checkpoint",
                );
              }
            }
          }
        })
        .finally(() => {
          this.active.delete(run.id);
          this.store.release(run.id);
        });
    }
  }
  control(id: string, action: "pause" | "resume" | "cancel"): void {
    const run = this.store.get(id);
    this.store.log(id, `Execution control: ${action}`);
    if (["done", "handoff", "cancelled"].includes(run.state)) return;
    if (action === "resume") {
      if (this.active.has(id))
        throw new Error("Wait for active stage interruption before resume");
      run.paused = 0;
      run.error = null;
    } else {
      run.paused = 1;
      this.active.get(id)?.abort();
      if (action === "cancel") {
        run.state = "cancelled";
        this.store.db
          .prepare(
            "UPDATE decisions SET status='cancelled' WHERE runId=? AND status='pending'",
          )
          .run(id);
      }
    }
    this.store.save(run);
    this.store.db
      .prepare("UPDATE runs SET paused=? WHERE id=?")
      .run(run.paused, id);
  }
  shutdown(): void {
    for (const controller of this.active.values()) controller.abort();
  }
}
