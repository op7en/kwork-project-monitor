# Milestone 3: secure email parser design

Status: approved by owner in chat on 2026-10-11; original synthetic foundation extended by the owner-confirmed observed-table addendum below.
Baseline: 782da2567850003155873d9eca2508edad333a18. One privately sanitized local fixture exists and is not authorized for Git publication.

## Intent and scope

Build an offline-testable Gmail message ID → verified metadata → full payload → bounded MIME decoding → block-oriented parser → KworkProject[] flow. Preserve Milestone 2 metadata CLI and Telegram behavior. No live Gmail calls, persistence, notifications, AI, deployment or Git publication during development.

## Decisions

1. Reuse existing OAuth scope/account verification. Add a separate project reader without broadening the metadata-only client contract. Its caller must supply a confirmed sender allowlist. Empty/invalid policy fails before reading mail. Require a single exact Subject and a single conservative mailbox From; reject ambiguous headers. Recheck ID and headers on full response. From matching is a filter, not cryptographic authentication.
2. Use users.messages.get(format=full), not raw RFC 822. Do not retrieve snippets, raw or attachments. MIME traverses only text/plain, text/html and multipart parts, never forwarded message/rfc822 or attachment subtrees. Strict base64url alphabet, padding and canonical roundtrip; fatal TextDecoder with explicit charset support. Prefer HTML when it produces projects, otherwise plain text; never combine alternatives into duplicate records.
3. Pure parser functions have no network or logging. A trusted caller supplies format policy: explicit non-overlapping HTML card selector, plain paragraph grammar, and direct URL pathname prefix. There is no guessed production default. Tests and offline CLI use an explicitly synthetic policy and synthetic data. Missing policy rejects processing. A real fixture is required to confirm selectors, labels, sender and paths.
4. HTML parser: node-html-parser, a data-only DOM parser. Extract fields within a complete selected card; nested/overlapping cards or multiple distinct identities/titles reject that card. No global arrays joined by index. Plain text uses independent blank-line-separated labelled project blocks. Unknown optional fields are omitted; ambiguous mandatory fields reject the block.
5. Compact domain: projectId, title, url, sourceGmailMessageId; optional budget, customerName, hireRate, customerStatistics. Budget has raw text, currency, kind=fixed/range/up-to/from and corresponding amount/min/max; desired and maximum budgets are separate slots, never collapsed. Statistics require known explicit labels. No inferred names, percentages or prices.
6. URL policy uses standard URL parsing, exact approved hostname, HTTPS, credentials/port/control/backslash rejection, exact configured path and decimal positive ID. Reject encoded pathname, dot segments, relative/redirect URLs and query parameters. Do not construct a URL from an ID or resolve redirects. Synthetic path is explicitly fictitious; owner-supplied examples determine the real policy.
7. Deduplication is bounded to this call, first valid occurrence in caller-supplied message order wins; keep its sourceGmailMessageId. No processed-state mutation. Diagnostics consist only of enumerated codes, never body, sender, URL, API error descriptions or credentials.

## Resource bounds

1 MiB decoded content and metadata size gate; 2 MiB aggregate encoded input; 128 MIME nodes, depth 16. HTML/text length ≤ 1 MiB, DOM depth 64 and 10,000 elements, at most 100 project blocks per message, title ≤ 300 characters. Violations reject that message safely. These are application processing limits, not a proven hard streaming network download cap.

## Acceptance and review

Red/green tests cover exact/near Subject, sender gates, account/scopes, full failures, MIME nesting/alternatives/attachments/charset/base64/limits, budgets and cross-card ambiguity, strict URL adversarial cases, scripts/instructions as data, offline complete flow and no network/logs. Required checks: typecheck, tests, lint, build, audit, diff check, status. Three independent domain reviews and a separate Codex Security scan include untracked files and dependencies. Correct confirmed Milestone 3 P0/P1 findings.

## Initial real-format acceptance requirements (historical)

Owner must supply an anonymized notification: preserved HTML structure plus text alternative if available, exact public sender, exact Subject, Content-Type/charset, and representative direct project links. Remove recipient addresses, personal names/user IDs, message/thread IDs, tracking identifiers and authentication headers. Replace titles/customer names with synthetic text, keep field labels and numeric formats. No OAuth data or .env. Until then the deliverable can only be READY WITH WARNINGS for synthetic offline functionality.

## Alternatives considered

- Raw RFC 822 parser: unnecessary complexity when Gmail already exposes MIME structure.
- Globally extract anchors/prices and correlate indexes: rejected because field provenance cannot be proven.
- Hardcode presumed Kwork sender/selectors/paths: rejected because no real source evidence exists.

F1/F2/F3 remain separate technical debt. No changes to Telegram handlers or retry policy.

## Binding observed-table addendum (owner authorized)

The owner confirmed Название / Покупатель / Цена in a three-cell table, one project row, clickable title, below-title description/category text, buyer statistics labelled проектов на бирже and нанято, and integer price with ₽. No separate desired/maximum budgets appear. Public project URLs have exact HTTPS kwork.ru /new_offer and one positive decimal project query ID; actual IDs are never hardcoded.

Extend the existing format policy with kwork-table-v1; retain synthetic-v1 unchanged. Parse only direct rows/cells of a semantically confirmed table; no pseudo-class selectors. Identity/title remain in first cell, buyer statistics in second, price in third. Reject ambiguous spans, nested selected tables and collapsed cells. Add optional price (raw/RUB/integer amount), details (whole description/category text), and exchangeProjects (only exact signed label); never guess their missing values or split unconfirmed category boundaries.

URLs preserve the supplied valid direct link. Admit only the confirmed project parameter; reject duplicates, userinfo, explicit ports, lookalikes, encoded/normalized path ambiguity, fragments and redirect/tracking keys. No HTTP resolution. Keep first valid ID/provenance and all existing resource/privacy gates. Signed stats count captions with a stop at two, then validate one exact structured line. Inline CSS containing comments/escapes is conservatively excluded to avoid hidden-data obfuscation.

The local sanitized fixture is owner-authorized only for local acceptance. Its original CSS classes and source description/category boundary remain unconfirmed. Do not publish or scan it externally. Independently author synthetic table fixtures from public structure for tests and the offline CLI. Final checks and a NEW Codex Security working-tree diff scan cover the final code and synthetic fixtures; no original/privately sanitized mail or environment files enter the scan.
