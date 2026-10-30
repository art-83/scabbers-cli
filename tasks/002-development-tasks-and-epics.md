# Separate Development workflow for tasks and epics

Status: **To do**

Add a Development area for selected tasks and stories, with epics decomposed into bounded work items. Keep the existing Bug Triage → Bug Fix workflow intact.

## Expected behavior

- Offer an explicit way to select work from Jira for analysis, with the selected source and scope visible.
- Use a distinct workflow and eligibility policy for tasks/stories; do not pass them through the existing bug-only JEV gates.
- Analyze actual requirements, repositories, dependencies and acceptance criteria before asking JEV whether a bounded implementation may proceed.
- Make decisions, dependencies and implementation order explicit when decomposing an epic.
- Preserve current bug queues, persisted run identifiers, human publication approval and staging validation.

## Acceptance criteria

Task/epic intake and JEV criteria are defined and independently verified. New work cannot be confused with or silently enter the existing bug workflow. Existing Bug Triage and Bug Fix behavior remains compatible.

## Validation evidence

Pending implementation. The current delivery only renames the existing tabs; it does not activate task or epic execution.
