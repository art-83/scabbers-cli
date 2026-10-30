import { createMachine } from "xstate";
export const operationalMachine = createMachine({
  id: "operational-v1",
  initial: "queued",
  states: {
    queued: { on: { START: "investigating" } },
    investigating: { on: { PLAN: "planApproval", ASK: "waiting" } },
    waiting: { on: { ANSWER: "investigating" } },
    planApproval: {
      on: {
        PLAN_APPROVED: "building",
        REVISE: "investigating",
        MANUAL: "handoff",
      },
    },
    building: { on: { BUILT: "testing" } },
    testing: { on: { TESTED: "review", REVISE: "building" } },
    review: { on: { REVIEWED: "executionApproval", REVISE: "building" } },
    executionApproval: {
      on: {
        EXECUTION_APPROVED: "executing",
        REVISE: "building",
        MANUAL: "documenting",
      },
    },
    executing: { on: { EXECUTED: "verifying", UNCERTAIN: "reconciliation" } },
    verifying: { on: { VERIFIED: "documenting", UNCERTAIN: "reconciliation" } },
    reconciliation: { on: { REPLAN: "investigating", MANUAL: "handoff" } },
    documenting: { on: { DOCUMENTED: "done" } },
    done: { type: "final" },
    handoff: { type: "final" },
    cancelled: { type: "final" },
  },
  on: { CANCEL: ".cancelled", SCOPE_CHANGED: ".reconciliation" },
});
