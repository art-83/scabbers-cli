export type EligibilityVerdict = {
  classification: "A-candidate" | "B" | "C";
  score: number;
  rubric: string;
  answers: unknown[];
};
