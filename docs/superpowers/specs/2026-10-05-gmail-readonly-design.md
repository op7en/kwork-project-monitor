# Milestone 2: Gmail READ ONLY

## Approved intent

Independent local Gmail smoke check for the owner's expected account. Read only
message identifiers, dates and Subject; never retrieve body. Telegram startup and
handlers remain independent. The owner approved this design and inline execution,
including the specification and plan without further approval, on 2026-10-05.
No commit, push, PR or live smoke check by the agent.

## Components and flow

- `src/config/gmail.ts`: `loadGmailConfig()` validates the four required Gmail
  environment variables, rejecting missing values and example placeholders. It
  reuses `ConfigError`; Telegram configuration requires no Gmail credentials.
- `src/gmail/client.ts`: official `googleapis` OAuth2 and a narrow read-only API.
  Obtain an access token from the refresh token, inspect its actual scopes, verify
  the profile email for `me`, then expose list and metadata retrieval only.
- `src/gmail/kworkEmails.ts`: bounded paginated subject search and exact Subject
  comparison; return `KworkEmail { id, threadId?, receivedAt?, subject }`.
- `src/gmail/check.ts` and `src/gmail/smokeCheck.ts`: local CLI and testable runner
  invoked by `npm run gmail:check`, with safe
  success counts and errors. No account address, identifiers or email content in
  logs. Node loads the user's environment file only when they run this command.

The required scope is `https://www.googleapis.com/auth/gmail.readonly`.
Additional non-Gmail scopes are permitted. Known read-only Gmail scopes
(`gmail.metadata`, `gmail.addons.current.message.readonly`) are permitted too.
Any other Gmail scope, including unknown future Gmail permissions and
`https://mail.google.com/`, is refused before getProfile. No mutation endpoints
are exposed or called. OAuth errors are replaced, without raw messages or causes.

The profile must match the configured expected email case-insensitively; mismatch
or missing profile email stops the operation. Search uses
`subject:"Новые проекты на бирже Kwork"`, followed by metadata requests with
`format=metadata`, `metadataHeaders=['Subject']` and selected response fields.
Only an exact Subject value is accepted; ambiguous/missing Subject is rejected.
Identifiers are required, thread/date are optional, malformed date is omitted.

Smoke check examines at most 50 candidates and five pages, sorts accepted metadata
by received date and returns at most five messages. This is a bounded sample, not
a complete mailbox count or a guarantee of the globally newest five messages.
No body, persistence, project extraction, filtering, notifications or scheduling.

## Evidence and tests

Fake the official OAuth and Gmail method boundary: access token -> token info ->
profile -> list/get. Tests cover configuration, example rejection, readonly scope
presence, identity scopes, broad/unknown Gmail scopes, account mismatch before
search, exact and similar Subjects, pagination bounds, absent data and safe errors.
Existing Telegram tests remain. Final commands: typecheck, tests, lint, build,
npm audit, git diff --check, ignore and Git status checks. Security review must
never read `.env`; real credentials never enter fixtures, docs or tool output.

README explains Google Cloud, Gmail API enablement, OAuth consent/test user,
own web client credentials with OAuth Playground, offline readonly consent and
refresh token, configuration and manual smoke check. AGENTS records the scope,
metadata-only milestone and credential boundaries without duplicating env rules.
