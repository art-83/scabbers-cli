export class EngineeringWorkflow {
  static readonly statuses = [
    "To Do",
    "Open",
    "Analysis",
    "Solution Analysis",
    "In Progress",
    "Docs & Tests",
    "Ready for Code Review",
  ] as const;
  constructor(
    private readonly allowed: readonly string[] = EngineeringWorkflow.statuses,
  ) {}
  includes(status: string): boolean {
    return this.allowed.some(
      (name) => name.toLowerCase() === status.toLowerCase(),
    );
  }
  assertTarget(status: string): void {
    if (!this.includes(status))
      throw new Error(
        "Engineering workflow stops at Ready for Code Review; target is outside the approved scope: " +
          status,
      );
  }
}
