export type JiraIssue = {
  key: string;
  fields: Record<string, any> & {
    issuetype: { name: string };
    project: { key: string };
    description: unknown;
    status?: { name: string; statusCategory?: { key: string } };
  };
};
