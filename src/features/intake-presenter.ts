import type { IntakePreview } from "./types/intake-preview.js";
import type { PreviewSummary } from "./types/intake-status.js";
export class IntakePresenter {
  summary(raw: unknown): PreviewSummary | null {
    const preview = raw as IntakePreview | undefined;
    return preview
      ? {
          status: preview.status,
          board: preview.board?.name,
          jql: preview.jql,
          families: preview.families.map((f) => ({
            root: f.root,
            members: f.members.map((i) => i.key),
          })),
          pending: preview.pending.length,
          discovery: preview.discovery
            ? {
                seed: preview.discovery.seed,
                members: Object.keys(preview.discovery.nodes).length,
                pending: preview.discovery.pending.length,
              }
            : null,
          excluded: preview.excluded,
          error: preview.error,
          checkedAt: preview.checkedAt,
        }
      : null;
  }
}
