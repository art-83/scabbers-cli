import { z } from "zod";
import { stageResultSchema, type StageResult } from "./types/stage-result.js";
import { structuredQuestionSchema } from "./structured-question-schema.js";

/** Normalize a known provider shape without inventing answers or weakening validation. */
export class StageResultReader {
  parse(raw: unknown): StageResult {
    const candidate = z.record(z.string(), z.unknown()).parse(raw);
    if (candidate.question !== null && typeof candidate.question === "object") {
      const question = structuredQuestionSchema.parse(candidate.question);
      for (const field of ["decision", "decisionContext"] as const) {
        if (question[field] === undefined) continue;
        if (
          candidate[field] !== undefined &&
          JSON.stringify(candidate[field]) !== JSON.stringify(question[field])
        )
          throw new Error(
            `Conflicting nested and top-level ${field} in generated stage result`,
          );
        candidate[field] = question[field];
      }
      candidate.question = question.text;
    }
    return stageResultSchema.parse(candidate);
  }
}
