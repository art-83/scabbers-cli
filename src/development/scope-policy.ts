import { ProductCatalog } from "./product-catalog.js";
const allowed = new Set(["arccanet-backend", "arccanet-frontend", "arcca-pdv"]);
export class ScopePolicy {
  private readonly products = new ProductCatalog();
  assert(repositories: string[], products: string[]): void {
    if (!repositories.length || repositories.some((r) => !allowed.has(r)))
      throw new Error(
        "Autonomous development requires identified NOLA web repositories",
      );
    const normalized = products.map((product) =>
      this.products.identifier(product),
    );
    if (products.some((p) => /totem|smart[ -]?pos|noah/i.test(p)))
      throw new Error(
        "Totem, SmartPOS and mixed product scope require human handoff",
      );
    if (
      products.length === 0 ||
      normalized.some(
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
        "Unrecognized product identifiers in the generated plan; inspect the controller product catalog or correct the classification using verified evidence. A web checkout does not authorize unidentified products",
      );
  }
}
