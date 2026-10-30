import { z } from "zod";
export const browserSchema = z.strictObject({
  executable: z.string().min(1).optional(),
  profileDirectory: z.string().min(1).optional(),
  testOrigin: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.hostname.includes("*") &&
        !url.username &&
        !url.password &&
        value === url.origin
      );
    }, "Use an exact HTTPS origin without a path, trailing slash or credentials")
    .optional(),
});

/** Retain the selected check target; legacy Scabbers approvals never become engine permissions. */
export function migrateBrowser(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const config = input as Record<string, unknown>;
  if (!config.browser || typeof config.browser !== "object") return input;
  const browser = config.browser as Record<string, unknown>;
  if (!("approvedOrigins" in browser)) return input;
  const { approvedOrigins, ...settings } = browser;
  if (
    !settings.testOrigin &&
    Array.isArray(approvedOrigins) &&
    approvedOrigins[0]
  )
    settings.testOrigin = approvedOrigins[0];
  return { ...config, browser: settings };
}
