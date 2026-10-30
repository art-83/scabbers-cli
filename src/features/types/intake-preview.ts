import type { Family } from "./family.js";
import type { Discovery } from "./discovery.js";
export type IntakePreview = {
  configuration: string;
  status: "discovering" | "complete" | "blocked";
  board?: { name: string; filterId: string; statusIds: string[] };
  jql?: string;
  token?: string;
  tokens: string[];
  lastPage: boolean;
  pending: string[];
  families: Family[];
  excluded: { key: string; reason: string }[];
  discovery?: Discovery;
  blockedDiscoveries?: { state: Discovery; error: string }[];
  error?: string;
  checkedAt: number;
};
