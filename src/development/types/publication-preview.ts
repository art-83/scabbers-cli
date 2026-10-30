export type PublicationPreview = {
  digest: string;
  diff: string;
  repositories: Record<string, { head: string; diff: string }>;
};
