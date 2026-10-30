# Operational Tasks with two explicit approvals

Status: **Done**

Separate operational Tickets from Bug Fix and Development using an independent XState machine and modular injected stage classes.

## Accepted scope

- Discover only owner-assigned, Scabbers-routed Tickets; retain the global worker limit and existing bug/feature flows.
- Investigate and document an operational creation plan; evaluate it using its own JEV rubric.
- Require explicit plan approval before writing scripts. Run meaningful fixture tests without network, host HOME or credentials; obtain an independent review.
- Document complete files, tests, preconditions, risks, rollback instructions and verification criteria. Progress through permitted Jira engineering transitions, up to Ready for Code Review.
- Require a second explicit approval of the exact implementation before operational preflight/execution. Changes revoke the corresponding authorization; Resume never substitutes for approval.
- Verify identity, targets and preconditions, record one launch, observe outputs and sanity read-back, document and notify the owner.
- Uncertain/failing launches require reconciliation. Never automatically repeat or roll back a mutation. Unsupported targets remain manual documentation.

## Verification

Local fixture coverage exercises both approvals, real isolated unit checks, local mutation/read-back, ownership, changed requirements and files, interrupted launches, account mismatch, stale approvals, manual handling, Jira polling/progression and the dedicated JEV contract. No real production operation is part of development verification. Full build and suite: **257 tests in 36 files passed**. Formatting and packaging checked; the required commit hook runs Gitleaks, Prettier and the suite again. Live Jira metadata confirmed the existing operational Ticket is owner-assigned and in To Do. The Ticket was queued locally for a manual test with a private backup; no operational production mutation was performed.
