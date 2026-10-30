export type Decision = {
  id: string;
  runId: string;
  userId: string;
  channel: string | null;
  thread: string | null;
  question: string;
  options: string;
  status: string;
  answer: string | null;
  createdAt: number;
  nextReminder: number;
  version: number;
};
