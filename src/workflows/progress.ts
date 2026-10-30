import type { Run } from "./types/run.js";
const stages = {
  support: ["queued", "investigating", "routing", "done"],
  development: [
    "queued",
    "investigating",
    "eligibility",
    "regression",
    "fixing",
    "review",
    "findings",
    "finalTests",
    "publication",
    "staging",
    "e2e",
    "humanValidation",
    "done",
  ],
};
export function progress(run: Run): string {
  const workflow = stages[run.kind];
  const index = workflow.indexOf(run.state);
  if (index < 0) return run.state;
  const filled = Math.round((index / (workflow.length - 1)) * 8);
  return (
    "[" +
    "━".repeat(filled) +
    "·".repeat(8 - filled) +
    `] ${index}/${workflow.length - 1}`
  );
}
