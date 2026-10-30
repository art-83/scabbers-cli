export type JiraIssue = {
  key: string;
  fields: Record<string, any> & {
    issuetype: { name: string; hierarchyLevel?: number; subtask?: boolean };
    project: { key: string };
    description: unknown;
    status?: { name: string; statusCategory?: { key: string } };
  };
};
