export type RunKind = "support" | "development" | "feature";
export type Run = {
  id: string;
  kind: RunKind;
  source: string;
  state: string;
  engine: "claude" | "codex";
  sessionId: string | null;
  profileVersion: string;
  snapshot: string | null;
  data: Record<string, unknown>;
  error: string | null;
  paused: number;
  createdAt: number;
  updatedAt: number;
};
