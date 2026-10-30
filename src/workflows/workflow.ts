import { WorkflowEvidence } from "./evidence-guards.js";
import { createActor, type AnyActorRef } from "xstate";
import { supportMachine, developmentMachine } from "./machines.js";
import type { Run } from "./types/run.js";
import type { Store } from "../storage/store.js";
export class Workflow {
  constructor(private readonly store: Store) {}
  transition(run: Run, event: string): Run {
    const machine =
      run.kind === "support" ? supportMachine : developmentMachine;
    const actor: AnyActorRef = createActor(
      machine,
      run.snapshot ? { snapshot: JSON.parse(run.snapshot) } : {},
    ).start();
    if (!actor.getSnapshot().can({ type: event })) {
      actor.stop();
      throw new Error(`Event ${event} is not allowed in ${run.state}`);
    }
    try {
      new WorkflowEvidence(this.store).assert(run, event);
    } catch (error) {
      actor.stop();
      throw error;
    }
    actor.send({ type: event });
    run.state = String(actor.getSnapshot().value);
    run.snapshot = JSON.stringify(actor.getPersistedSnapshot());
    actor.stop();
    run.error = null;
    this.store.save(run);
    this.store.log(run.id, `${event} → ${run.state}`);
    return run;
  }
}
