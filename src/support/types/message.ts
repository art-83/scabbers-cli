export type Message = {
  ts: string;
  text: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  thread_ts?: string;
};
