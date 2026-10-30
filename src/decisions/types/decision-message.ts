export type DecisionMessage = {
  timestamp: string;
  version: number;
  channel: string;
  thread: string;
  numbered: boolean;
  reactionsReady: boolean;
  lastReactionAttempt: number;
};
