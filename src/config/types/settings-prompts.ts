import type { choose, text, secret } from "../../tui/prompts.js";
export type Prompts = {
  choose: typeof choose;
  text: typeof text;
  secret: typeof secret;
};
