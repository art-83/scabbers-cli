import { createMachine } from "xstate";
export const supportMachine = createMachine({
  id: "support-v1",
  initial: "queued",
  states: {
    queued: { on: { START: "investigating" } },
    investigating: { on: { READY: "routing", ASK: "waiting" } },
    waiting: { on: { ANSWER: "investigating" } },
    routing: { on: { PUBLISHED: "done", ASK: "waiting" } },
    done: { type: "final" },
    cancelled: { type: "final" },
  },
  on: { CANCEL: ".cancelled" },
});
export const developmentMachine = createMachine({
  id: "development-v1",
  initial: "queued",
  states: {
    queued: { on: { START: "investigating" } },
    investigating: { on: { FORM: "eligibility", ASK: "waiting" } },
    eligibility: { on: { ELIGIBLE: "regression", REJECT: "handoff" } },
    regression: { on: { FAILING: "fixing", REJECT: "handoff" } },
    fixing: { on: { GREEN: "review" } },
    review: { on: { REVIEWED: "findings" } },
    findings: { on: { GREEN: "finalTests" } },
    finalTests: { on: { GREEN: "publication" } },
    publication: { on: { PUBLISHED: "staging" } },
    staging: { on: { DEPLOYED: "e2e" } },
    e2e: {
      on: { PASSED: "humanValidation", FAILED: "waiting", ASK: "waiting" },
    },
    humanValidation: { on: { VALIDATED: "done", REJECT: "waiting" } },
    waiting: { on: { ANSWER: "investigating" } },
    handoff: { type: "final" },
    done: { type: "final" },
    cancelled: { type: "final" },
  },
  on: { CANCEL: ".cancelled" },
});
