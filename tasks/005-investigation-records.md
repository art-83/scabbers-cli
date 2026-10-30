# Durable Jira investigations and clear technical handoffs

Status: **Done**

## Product behavior

Detailed investigation belongs in Jira, including its evidence, pinned code revisions, facts, hypotheses, missing capabilities, risks and why a human or new capability is needed. Preserve genuine product questions and all explicit approvals, while technical failures do not automatically create Slack decisions/reminders. Do not force every card into a human handoff; routine in-scope choices remain autonomous.

## Implementation and verification

A decorated stage runner saves complete structured analysis before publishing bounded, credential-redacted, idempotent comments. A documentation-only retry reuses the pending result; changed inputs invalidate reuse. Feature context from foreign parents is written only on owned implementation scope cards. Non-eligible JEV outcomes record the detailed plan and rubric, reusing evaluation if only documentation failed. A valid blocked manual operational plan is documented and handed off without a private creation question; executable plans still require both approvals; a blocked executable plan remains blocked.

Tests cover blocked manual/executable plans, Jira outages without another model call, changed owner answers, correct target scope, redaction and silent technical worker handoffs. Existing investigations are recovered from persisted evidence without rerunning the model. No production mutation is performed by this task.

Validation: the full build and suite passed **266 tests in 37 files**. Eleven investigation records were published from saved checkpoints without new model calls; the operational manual plan was recovered and its obsolete technical Slack decision superseded. A private database backup precedes recovery. Runtime remains stopped for the next manual test.
