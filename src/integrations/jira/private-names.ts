import type { JiraIssue } from "../types/jira-issue.js";
export function privateNames(issue: JiraIssue): string[] {
  const people = [
    issue.fields.reporter,
    issue.fields.assignee,
    issue.fields.creator,
    ...(issue.fields.allComments ?? []).flatMap((comment: any) => [
      comment.author,
      comment.updateAuthor,
    ]),
  ];
  return [
    ...new Set(
      people
        .map((person) => person?.displayName)
        .filter(
          (name): name is string =>
            typeof name === "string" && name.trim().length > 2,
        ),
    ),
  ];
}
