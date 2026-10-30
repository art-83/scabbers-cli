import type { z } from "zod";
import type { featureFormSchema } from "../feature-form-schema.js";
export type FeatureForm = z.infer<typeof featureFormSchema>;
