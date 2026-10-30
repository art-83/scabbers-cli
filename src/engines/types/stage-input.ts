export type StageInput = {
  runId: string;
  stage: string;
  prompt: string;
  cwd: string;
  sessionId: string | null;
  mode: "read" | "edit" | "browser";
  browserAuthorized: boolean;
  allowedOrigins?: string[];
  onSession: (id: string) => void;
  directories?: string[];
  readDirectories?: string[];
  onProcess?: (pid: number) => void;
  onActivity?: (message: string) => void;
  signal?: AbortSignal;
};
