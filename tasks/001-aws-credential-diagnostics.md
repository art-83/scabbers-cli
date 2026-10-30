# AWS credential diagnostics

Status: **To do**

Improve diagnostics when Scabbers resolves a JEV credential through AWS Systems Manager Parameter Store. Keep the current credential flow unchanged until this task is implemented.

## Expected behavior

- Explain which configured AWS profile and region are being used, without exposing credentials.
- Distinguish expired/missing local authentication, missing SSM permissions and an unavailable parameter when the AWS response provides reliable evidence.
- Show the user how to resolve the specific blocker without asking for tokens in chat or Slack.
- Preserve local/environment/SSM credential precedence and keep decrypted values out of logs and settings.

## Acceptance criteria

Representative successful and failed resolutions produce accurate, actionable diagnostics without disclosing secrets. Existing callers and credential resolution behavior remain compatible.

## Validation evidence

Pending implementation. No AWS authentication or permission changes are authorized by this backlog entry.
