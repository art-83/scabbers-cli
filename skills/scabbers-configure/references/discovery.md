# Field discovery

| Field                                   | Evidence or proposed default                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `paths`                                 | Ask for Arcca repository/workspace directories if absent; ordered SOUL.md search roots, default `[]`                                |
| `version`                               | Application schema default                                                                                                          |
| `engine`                                | Explicit user choice, then existing configuration, then schema default                                                              |
| `workers`                               | Existing choice, otherwise 3                                                                                                        |
| `remoteEnabled`                         | Always false in generated output                                                                                                    |
| `slack.user`                            | Current Slack profile; verify against the Atlassian email when available                                                            |
| `slack.channel`, `reportBotIds`         | NOLA application defaults, confirmed through channel/source reads when connected                                                    |
| Slack SSM parameter references          | Existing private configuration references only; app setup in the UI does not imply a locally available token                        |
| `schedule.zone`                         | Explicit preference, verified profile timezone, otherwise proposed America/Sao_Paulo                                                |
| `schedule.shifts`                       | Explicit choices; otherwise Monday–Friday entries with `day`, `start: "09:00"`, `end: "18:00"`                                      |
| `jira.accountId/email`                  | Current Atlassian user info, not an ID guessed from a display name                                                                  |
| `jira.baseUrl/project`                  | Accessible site and actual NOLA project evidence; existing verified values can be reused                                            |
| Jira routing fields                     | Existing mappings or live metadata; otherwise `{}` / `[]`                                                                           |
| GitLab base URL/project identifier      | Connected project lookup, or selected repository's actual origin remote                                                             |
| Repository paths/test argv/staging URLs | Selected local repository scripts and explicit staging configuration; omit incomplete repository entries and report what is missing |
| `skillPaths`                            | Installed catalog locations, using Scabbers discovery when available                                                                |
| `aws.profile/region`, `jevKeyParameter` | Existing known private references; no credential values                                                                             |
| `historySources`                        | Explicitly selected files only; default `[]`                                                                                        |

Plugin discovery uses available tool descriptions, not hardcoded connector IDs. Atlassian current-user info returns `account_id`; Slack current-profile can omit the user ID in concise output, so request a detailed profile or verify a known member ID. Prefer those identity operations over searching email when email is not indexed. A connected GitLab tool is optional: an authenticated plugin session is not a token the standalone CLI can reuse.

Brazilian defaults are proposals. The requested 12-hour presentation is equivalent to these CLI-compatible examples: `9 AM -> 09:00`, `6 PM -> 18:00`, `12 AM -> 00:00`, `12 PM -> 12:00`. Do not claim AM/PM is universal in Brazil or assume every Brazilian location has São Paulo's timezone.

Discovery input shape:

```json
{
  "config": {},
  "evidence": [
    {
      "fields": ["jira.accountId"],
      "source": "Atlassian current-user connection",
      "status": "verified"
    }
  ],
  "unresolved": [
    "slack.appTokenParameter: no supported local app-level credential reference found"
  ]
}
```

The report can contain non-secret identities and local paths, but must not contain raw API responses, phone numbers, token values or unrelated personal profile data. Record enough source attribution to explain a value, not entire retrieved messages. Default provenance is separate from verified evidence.
