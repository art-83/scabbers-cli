import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageEvidence } from "../abstractions/interface/image-evidence.js";
import type { JiraIssue } from "../types/jira-issue.js";
import type { IssueImage } from "../types/issue-image.js";
import type { HttpClient } from "../http-client.js";

export class JiraImages implements ImageEvidence {
  private readonly cache = new Map<string, IssueImage>();
  constructor(
    private readonly http: HttpClient,
    private readonly directory: string,
  ) {}
  async prepare(
    issues: JiraIssue[],
    signal: AbortSignal,
  ): Promise<IssueImage[]> {
    const images: IssueImage[] = [];
    let bytes = 0;
    const seen = new Set<string>();
    for (const issue of issues) {
      for (const attachment of issue.fields.attachment ?? []) {
        if (!String(attachment.mimeType).startsWith("image/")) continue;
        const id = String(attachment.id);
        if (!/^\d+$/.test(id) || !/^[A-Z][A-Z0-9]+-\d+$/.test(issue.key))
          throw new Error("Invalid Jira image identity");
        if (seen.has(id)) continue;
        seen.add(id);
        if (seen.size > 12)
          throw new Error(
            "More than 12 Jira images in this analysis; narrow the evidence scope",
          );
        const extension = (
          {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
          } as Record<string, string>
        )[attachment.mimeType];
        if (!extension)
          throw new Error(
            `Unsupported Jira image format for ${issue.key}; use PNG, JPEG or WebP`,
          );
        if (Number(attachment.size) > 5 * 1024 * 1024)
          throw new Error("Jira image exceeds 5 MiB");
        signal.throwIfAborted();
        const cached = this.cache.get(id);
        let data: Buffer | undefined;
        if (cached) {
          try {
            const candidate = readFileSync(cached.path);
            if (
              createHash("sha256").update(candidate).digest("hex") ===
              cached.sha256
            )
              data = candidate;
          } catch {}
        }
        // Never follow a supplied attachment URL or forward credentials to a CDN.
        data ??= await this.http.image(
          `/rest/api/3/attachment/content/${id}?redirect=false`,
          signal,
        );
        const valid =
          extension === "png"
            ? data
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : extension === "jpg"
              ? data[0] === 255 && data[1] === 216 && data[2] === 255
              : data.toString("ascii", 0, 4) === "RIFF" &&
                data.toString("ascii", 8, 12) === "WEBP";
        if (!valid || data.length > 5 * 1024 * 1024)
          throw new Error(`Invalid Jira image content for ${issue.key}`);
        bytes += data.length;
        if (bytes > 20 * 1024 * 1024)
          throw new Error("Jira image evidence exceeds 20 MiB");
        const sha256 = createHash("sha256").update(data).digest("hex");
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        chmodSync(this.directory, 0o700);
        const path = join(this.directory, `${id}-${sha256}.${extension}`);
        writeFileSync(path, data, { mode: 0o600 });
        chmodSync(path, 0o600);
        const image = {
          issueKey: issue.key,
          attachmentId: id,
          filename: String(attachment.filename),
          mimeType: String(attachment.mimeType),
          path,
          sha256,
        };
        this.cache.set(id, image);
        images.push(image);
      }
    }
    return images;
  }
}
