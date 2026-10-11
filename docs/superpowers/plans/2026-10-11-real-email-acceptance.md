# Milestone 3: one-message real-format acceptance

Status: owner confirmed public headers, price/statistics meanings and /new_offer?project=<ID>; authorized local adapter work. The corrected Git-ignored fixture passes local offline parser acceptance. Original/private sanitized files are not authorized for Git publication or external scans; independently authored synthetic table fixtures cover tests. No repeat Gmail capture was performed.
Baseline: 782da2567850003155873d9eca2508edad333a18. Preserve all existing uncommitted Milestone 3 work.

## What the current code proves

The readonly project reader verifies actual OAuth scopes/account, then exact single Subject and a single mailbox From against a caller-supplied allowlist, message ID and size before full. The full response is rechecked. From matching is a filter, not cryptographic authentication. The parser supports only synthetic-v1, explicit cards, h2 project anchors, labelled p fields and fictitious project links. It is not yet a real Kwork adapter.

## Gate 1: agree on one target and permission

Owner identifies one notification: exact public From and date/time, or an exact Gmail message ID. A Gmail web URL often identifies a thread; do not treat it as a confirmed message ID. Prefer one notification with several project cards, distinct budgets and a missing optional field.

If selection is not unique, use only bounded metadata to identify candidates. Metadata fields: id, internalDate, sizeEstimate, Subject, From; no body/snippet/raw/attachments. Display only candidate aliases, date/time, subject-match/sender-match status and size; keep identifiers local. Freeze the selected message ID before any body call. Do not silently select a different message on failure.

Before full, show the owner the selected metadata description and request separate explicit permission to read the body of that one message. Do not interpret prior metadata permission or approval of this procedure as body permission. Sender allowlist must use the exact owner-confirmed mailbox; never disable it or trust any sender/domain by default.

## Capture and local sanitization after permission

1. Prepare a narrowly scoped local capture/sanitization helper with synthetic tests before running it. It must accept one frozen ID and the confirmed sender, have no search/fallback loop and no mail mutation or attachment-fetch capability. It must not print raw responses/errors, body, HTML, MIME or credentials.
2. Credentials are consumed through environment variables by the existing application config locally. The owner subsequently explicitly authorized Node's standard --env-file-if-exists=.env launcher for the local helper; the helper itself never reads/copies/prints .env or environment values. If configuration is still absent, stop; do not invent secrets or retrieve them through another plugin. Only local Google SDK requests to the OAuth/Gmail providers are allowed. No Gmail connector or other external plugin receives the email.
3. Perform the existing scopes/account checks. Get Subject/From metadata for that exact ID; require unique exact Subject, confirmed sender and acceptable size. Only then request structured format=full. Its payload includes inline MIME text and MIME headers; no format=raw or attachment endpoint. Recheck the full ID, Subject/From and size. On a gate, decode or sanitization failure, stop; do not read another message.
4. Keep the unsanitized response in process memory only. Never write its original body or metadata to a file, Git, stdout/stderr or crash report. Limits and safe diagnostic codes remain in force. Process termination releases the working copy; secure memory erasure is not claimed.
5. Decode with the current MIME decoder. Preserve MIME nesting, content type/charset, HTML element hierarchy, relevant static classes/attributes, field labels and budget/statistics formats. Do not add synthetic-v1 cards/headings/labels to make parsing easier. Do not render HTML or fetch any link/resource.
6. Sanitize every exposed channel, not only visible text. Replace names, titles/descriptions and free text with neutral synthetic text; retain only verified structural field labels. Replace emails, phone numbers, personal/user/project/message/thread IDs, timestamps and tracking identifiers consistently. Keep distinct project identities distinct, including repeated links to the same project. Preserve hostname/path shape only for verified public project links, replacing actual IDs. Keep tracking query keys and encoding shape when useful, but replace all values, including nested URLs; never unwrap redirects. Replace resource URLs with inert placeholders. Remove/rewrite personal information in comments, inline attributes, CSS URLs, hidden markup, scripts, event handlers and encoded forms. No original-to-synthetic mapping is saved.
7. A field cannot be retained merely because a regex did not flag it. Unknown personal-looking text/attributes must be replaced or kept out of the candidate. Record a safe change summary (counts/categories, not before/after values). Mark altered/removed structures that could affect parser conclusions.
8. Save only the sanitized candidate under a verified Git-ignored .local-acceptance/ directory. Before writing, establish and verify that ignore rule; no staging. Suggested files: kwork-notification.sanitized.html.txt, kwork-notification.sanitized.plain.txt and kwork-notification.sanitized.json. The original is never saved. Sanitized JSON uses synthetic provenance and stripped headers; reconstructed envelope bytes/size are recalculated rather than labelled as original transport bytes.

## Gate 2: owner inspects the sanitized candidate

Show files locally in a plain source editor. No browser rendering and no plugin upload. Owner checks that personal data is absent, project block count/order and optional absences remain correct, distinct IDs are not merged, budget labels and values have the expected shapes, link forms are preserved and sanitation did not create guessed fields. Do not add this candidate to tests or present it to Context7/Codex Security before explicit fixture approval.

DOM serialization can repair malformed HTML. Record this limitation; preserve source form where practical and do not claim byte-for-byte structural identity. If the candidate cannot preserve a crucial structure without uncertainty, pause for owner review rather than fabricate a template.

## Adaptation only after fixture approval

- Define real-format expectations with the owner from the approved sample: exact block boundaries, project-title/URL binding, sender, allowed hostname/path/ID, budget/statistics labels and expected KworkProject values. One email is evidence for that observed template, not all historical/future templates.
- Apply Superpowers TDD: failing literal expectations on the approved sanitized sample, minimal real-format adapter, synthetic and adversarial regressions, independent review. Keep synthetic-v1 and real-template evidence distinguishable. Do not force the real HTML into h2/p assumptions.
- Use Context7/official docs for library/API questions only. No raw original, credentials or private mappings are sent. Owner permitted local adaptation but prohibited publication of the privately sanitized fixture; use independently authored synthetic fixtures in repository/tests and Codex Security.
- Freeze final changes, then run a NEW Codex Security diff scan including untracked code/fixtures and the CWE-400 regression. The old sealed scan does not prove the adapted final version.
- Run typecheck, full tests, lint, build, npm audit, parser checks for synthetic and real-derived fixture, diff --check, git status and bounded secret/privacy checks. No live Telegram, mail mutation, commit/push/PR or Milestone 4.

## Verdict rules

READY requires approved real-derived fixture expectations, correct fields/URLs/provenance, passing required checks and no unaddressed confirmed P0/P1. READY WITH WARNINGS must name limited template coverage and any remaining evidence gap. Until body permission and fixture approval, real-format acceptance is waiting on owner input; do not claim it passed or reuse the previous 231-test run as fresh evidence.
