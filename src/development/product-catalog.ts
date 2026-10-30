/** Exact, known product aliases; a web repository never grants permission for another product. */
export class ProductCatalog {
  private readonly aliases = new Map([
    ["web", "web"],
    ["nola web", "web"],
    ["nola pdv web", "web"],
    ["console web nola", "web"],
    ["console web", "web"],
    ["arccanet backend", "arccanet-backend"],
    ["arccanet frontend", "arccanet-frontend"],
    ["arcca pdv", "arcca-pdv"],
    ["api pdv", "arcca-pdv"],
    ["servico online menu", "arcca-pdv"],
    ["online menu", "arcca-pdv"],
  ]);
  identifier(product: string): string {
    const key = product
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[-_\s]+/g, " ");
    return this.aliases.get(key) ?? product.trim();
  }
}
