export type PreviewSummary = {
  status: "discovering" | "complete" | "blocked";
  board?: string | undefined;
  jql?: string | undefined;
  families: { root: string; members: string[] }[];
  pending: number;
  discovery: { seed: string; members: number; pending: number } | null;
  excluded: { key: string; reason: string }[];
  error?: string | undefined;
  checkedAt: number;
};
export type IntakeStatus = {
  enabled: boolean;
  preview: PreviewSummary | null;
  scan: PreviewSummary | null;
};
