import type { Store } from "../storage/store.js";
export class Effects {
  constructor(private readonly store: Store) {}
  completed<T>(key: string): T | undefined {
    const row = this.store.db
      .prepare("SELECT result FROM effects WHERE key=? AND status='done'")
      .get(key);
    return row ? (JSON.parse(String(row.result)) as T) : undefined;
  }
  async once<T>(
    runId: string,
    key: string,
    reconcile: () => Promise<T | undefined>,
    perform: () => Promise<T>,
  ): Promise<T> {
    const row = this.store.db
      .prepare("SELECT * FROM effects WHERE key=?")
      .get(key);
    if (row?.status === "done") return JSON.parse(String(row.result)) as T;
    if (row) {
      const existing = await reconcile();
      if (existing !== undefined) {
        this.complete(key, existing);
        return existing;
      }
      throw new Error(
        `Effect ${key} has an uncertain outcome. Inspect remote state before explicit retry.`,
      );
    }
    this.store.db
      .prepare("INSERT INTO effects(key,runId,status) VALUES(?,?,?)")
      .run(key, runId, "pending");
    const existing = await reconcile();
    if (existing !== undefined) {
      this.complete(key, existing);
      return existing;
    }
    const result = await perform();
    this.complete(key, result);
    return result;
  }
  private complete(key: string, result: unknown): void {
    this.store.db
      .prepare("UPDATE effects SET status=?,result=? WHERE key=?")
      .run("done", JSON.stringify(result), key);
  }
}
