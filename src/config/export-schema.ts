import { format } from "prettier";
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { configSchema } from "./types/config.js";
const directory = new URL("../../assets/", import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(
  new URL("settings.schema.json", directory),
  await format(
    JSON.stringify(
      {
        ...z.toJSONSchema(configSchema, { target: "draft-7" }),
        title: "Scabbers settings",
        description:
          "Editable NOLA Scabbers settings. Runtime state and SOUL approval are persisted separately.",
      },
      null,
      2,
    ),
    { parser: "json" },
  ),
);
