import { expect, it } from "vitest";
import { z } from "zod";
import { ProductCatalog } from "../src/development/product-catalog.js";
import { productSchema } from "../src/development/product-schema.js";
import { ScopePolicy } from "../src/development/scope-policy.js";

it.each([
  [["NOLA PDV web"], ["web"]],
  [["Nola Web"], ["web"]],
  [
    ["Console web NOLA", "API PDV", "Serviço online-menu"],
    ["web", "arcca-pdv", "arcca-pdv"],
  ],
  [
    ["  NOLA   WEB  ", "Arccanet_Frontend"],
    ["web", "arccanet-frontend"],
  ],
  [
    ["arccanet-backend", "arccanet-frontend", "arcca-pdv", "web"],
    ["arccanet-backend", "arccanet-frontend", "arcca-pdv", "web"],
  ],
])(
  "normalizes known product display names without requiring a human nomenclature decision: %j",
  (labels, expected) => {
    const products = z.array(productSchema).parse(labels);
    expect(products).toEqual(expected);
    const policy = new ScopePolicy();
    expect(() =>
      policy.assert(["arccanet-frontend", "arcca-pdv"], products),
    ).not.toThrow();
    expect(() =>
      policy.assert(["arccanet-frontend", "arcca-pdv"], labels),
    ).not.toThrow();
  },
);
it.each([
  "Totem",
  "SmartPOS",
  "noah-smart-pos",
  "Nola Web + SmartPOS",
  "web sem Totem",
  "unknown web service",
  "Unverified product",
  "serviço desconhecido",
])(
  "preserves excluded, mixed or unknown scope rather than guessing from a web checkout: %s",
  (label) => {
    expect(new ProductCatalog().identifier(label)).toBe(label);
    expect(() =>
      new ScopePolicy().assert(["arcca-pdv"], ["Nola Web", label]),
    ).toThrow();
  },
);
it("keeps repository restrictions and explicit empty scope checks", () => {
  const policy = new ScopePolicy();
  expect(() => policy.assert(["noah-smart-pos"], ["Nola Web"])).toThrow();
  expect(() => policy.assert([], ["Nola Web"])).toThrow();
  expect(() => policy.assert(["arcca-pdv"], [])).toThrow();
  expect(() => productSchema.parse(" ")).toThrow();
});
it("publishes canonical product guidance in the machine-readable contract", () => {
  const schema = z.toJSONSchema(productSchema);
  expect(schema.type).toBe("string");
  expect(schema.description).toContain("arccanet-frontend");
  expect(schema.description).toContain("never omit");
});
