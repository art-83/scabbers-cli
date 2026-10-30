export type BrowserDiagnostic = {
  status: "checking" | "connected" | "blocked";
  engine: string;
  origin: string;
  summary: string;
  checkedAt: number;
  sessionId: string | null;
  processId?: number;
};
