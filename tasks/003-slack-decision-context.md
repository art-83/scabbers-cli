# Slack decisions with context and workflow labels

Status: **To do**

## Problem and outcome

Private Scabbers messages currently lead with a direct question and optional choices. The recipient has to reconstruct the card, stage and reason for interruption from the thread. Runtime failures also resemble product questions. Every new private decision, reminder and blocker should explain its purpose before requesting action.

This is an implementation plan, not an implemented feature. It does not authorize sending example messages or rewriting existing Slack threads.

## Message structure

1. **Workflow label and card:** use explicit labels `Suporte · Bug Triage`, `Suporte · Bug Fix`, or `Feature · Development`, followed by the card title and verified Jira link when available. Derive labels from the persisted run kind, not from model guesses. Do not expose internal run hashes as user-facing titles.
2. **Context:** one or two short sentences describing the request and relevant work already verified. A message must make sense without reading earlier thread replies.
3. **Problem:** state the concrete ambiguity or technical blocker and what it prevents. Distinguish confirmed evidence from uncertainty.
4. **Needed action:** ask one consequential decision, or explain the maintenance action needed. Explain why existing cards/code/tests/logs did not settle a genuine human decision.
5. **Choices and consequences:** numbered options, with matching unique buttons and seeded reactions. Keep free-form replies in the same thread. Show a justified recommendation when supported; if implementation lacks evidence, recommend an evidence-gathering step rather than inventing facts.
6. **Current stage and response instructions:** keep these brief. An informational message need not manufacture a question or choices.

## Implementation sequence

- Add a dedicated context type under `src/decisions/types`, separate from presentation/service implementation. Store the context snapshot for each decision/version using the existing persisted decision-metadata pattern.
- Have support and development/feature processors forward the existing stage summary, verified card identity, relevant evidence and reason for interruption. Extend the structured stage output only for information that cannot already be derived deterministically; do not add a second model call just to format a message.
- Extend `DecisionPresentation` to render workflow label, context, problem, action and choices consistently in fallback text and Slack blocks. Keep complete option descriptions in the body even when button labels must be shortened.
- Apply the same presentation to initial private follow-up messages, decisions, reminders and checkpoint failures. Reminders repeat a compact context and current decision, without implying that old evidence was newly verified. Preserve the existing reminder interval.
- Give internal contract/infrastructure failures a clear technical-blocker label. They must not be presented as undecided product requirements. Offer retry only with an explanation of when it is meaningful; preserve pause semantics.
- Keep old decisions compatible: reconstruct only verified metadata available in their saved run when a context snapshot is absent. Do not silently overwrite old Slack messages or change pending answers.

## Boundaries

Preserve authenticated owner checks, channel/thread and version matching, answer deduplication, numbered reactions, direct thread replies, approval gates and queue separation. Do not change Jira statuses, product requirements, permissions, scheduling or public channel content as part of this private-message presentation change. Escape untrusted message text and omit credentials and unnecessary personal details.

## Acceptance and validation

- Each workflow has the correct explicit label and verified card identity.
- A decision can be understood from its own context/problem/action blocks.
- Legacy decisions, missing metadata, reminders and technical blockers have honest readable fallbacks.
- Rendering respects Slack limits, unique action IDs and long/escaped text; buttons and reactions map to the same canonical answers.
- Context remains stable across restart and cannot attach another card's evidence to the question.
- Recommendations never auto-answer or approve an action; informational messages do not require a choice.
- Unit tests use Slack doubles and cover these cases without sending real messages. Run formatting, build, full tests and Gitleaks before publication.

## Operational reset

The owner authorized clearing local Scabbers execution progress before retesting. Back up SQLite first, clear execution-specific decisions/receipts/effects/checkpoints and discovery progress, and remove only clean generated analysis worktrees. Preserve settings, credential references, SOUL versions, diagnostic logs and external Jira/Slack content. Keep the runtime stopped until the owner starts the next manual test. Resetting execution progress is separate from implementing this task.
