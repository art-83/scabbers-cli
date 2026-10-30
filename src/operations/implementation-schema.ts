import { z } from "zod";
export const operationalImplementationSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    files: z
      .array(
        z.object({
          path: z
            .string()
            .regex(/^[A-Za-z0-9_/-]+\.(?:sh|py|json|md)$/)
            .refine(
              (p) =>
                !p.startsWith("/") &&
                !p.includes("..") &&
                !p.split("/").includes(""),
              "Relative artifact paths only",
            ),
          content: z.string().min(1).max(12000),
        }),
      )
      .min(1)
      .max(12),
    testCases: z.array(z.string().min(1).max(500)).min(1).max(20),
  })
  .superRefine((bundle, ctx) => {
    if (new Set(bundle.files.map((f) => f.path)).size !== bundle.files.length)
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: "Artifact paths must be unique",
      });
    if (Buffer.byteLength(JSON.stringify(bundle)) > 30000)
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: "Implementation evidence exceeds 30 KB",
      });
  });
export const operationalReviewSchema = z.object({
  approved: z.boolean(),
  scopeMatchesPlan: z.boolean(),
  testsMeaningful: z.boolean(),
  verificationMeaningful: z.boolean(),
  credentialFree: z.boolean(),
  checksReadOnly: z.boolean(),
  findings: z.array(z.string().min(1).max(1000)).max(20),
  summary: z.string().min(1).max(2000),
});
export const operationalChecksSchema = z.object({
  checks: z
    .array(
      z.object({
        criterion: z.string().min(1),
        passed: z.boolean(),
        observed: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(10),
});
