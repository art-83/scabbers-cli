const allowed = new Set(["arccanet-backend", "arccanet-frontend", "arcca-pdv"]);
export class ScopePolicy {
  assert(repositories: string[], products: string[]): void {
    if (!repositories.length || repositories.some((r) => !allowed.has(r)))
      throw new Error(
        "Autonomous development requires identified NOLA web repositories",
      );
    if (
      products.length === 0 ||
      products.some((p) => /totem|smart[ -]?pos|noah/i.test(p)) ||
      products.some(
        (p) =>
          ![
            "web",
            "arccanet-backend",
            "arccanet-frontend",
            "arcca-pdv",
          ].includes(p.toLowerCase()),
      )
    )
      throw new Error(
        "Totem, SmartPOS and mixed or unidentified product scope require human handoff",
      );
  }
}
