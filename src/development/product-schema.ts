import { z } from "zod";
import { ProductCatalog } from "./product-catalog.js";
const catalog = new ProductCatalog();
export const productSchema = z
  .string()
  .trim()
  .min(1)
  .overwrite((product) => catalog.identifier(product))
  .describe(
    "Use canonical product identifiers: web, arccanet-backend, arccanet-frontend, arcca-pdv. Known display-name aliases are normalized by the controller. List every affected product, including Totem or SmartPOS if involved; never omit an excluded or unidentified product to pass eligibility.",
  );
