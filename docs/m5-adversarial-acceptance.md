# M5 adversarial acceptance (offline)

## Risk matrix and invariants, before fixes

| Risk | Impact | Testable invariant |
| --- | --- | --- |
| Incomplete discovery / retries / cursor | Critical: skipped mail | Cursor advances only after all fenced events have durable terminal outcomes; retry keeps cursor fixed; history IDs use BigInt. |
| Repeated baseline / initialization race | Critical: silently skipped backlog | Initial baseline is idempotent; replacing an existing cursor requires explicit confirmation; activation time precedes history capture. |
| Acceptance limits reset each pass | Critical: excess live operations | Separate acceptance reserves one run synchronously, selects one ID, rejects multiple events, reads at most one body and attempts at most one card using the persistent ledger. |
| Crash / missing or older database | High: duplicate notifications | Message and project reservation are atomic; reservations survive restart; absent/corrupt/stale ledger fails closed instead of silently becoming a fresh installation. |
| Cancellation / permission races | High: unauthorized operation | Genuine private owner confirmation is required; off drains the active request and permits no later request or send. |
| False-positive classification | High: irrelevant cards | Negation, quoted/unrelated stack mentions and ambiguous large scope cannot alone produce match. |
| Invisible paused/review state | Medium: misleading operational status | Status exposes fixed counts, last completion, next attempt and blocking error; review is visible as an aggregate. |
| Terminal parsing failure | Medium: missed repaired template | No automatic body reread; selective recovery requires separate owner authorization and preserves project tombstones. |
| Publication / experimental runtime | High: privacy or startup failure | Review every publishable path; no private artifacts; verify on actual Node 24.1.0. |

Previous 530-test result is historical. This review requires fresh verification after its changes. No live Gmail or Telegram calls are authorized.

## Confirmed findings and fixes

| Severity | Reproduction / actual old behavior | Final behavior and evidence |
| --- | --- | --- |
| Critical | Existing cursor + repeated baseline overwrote history/floor without separate acknowledgement. | baseline_exists before connect; explicit baseline confirm while OFF is the only replacement path. monitorPass / monitorFlow / monitorController regressions. |
| Critical | Clock advanced while history snapshot awaited: floor became later than new mail received between snapshot and commit. | Capture activation time before asynchronous setup. monitorPass initialization-race regression was RED then GREEN. |
| High | Message metadata/full GmailError 403 was swallowed into retry; three passes terminalized message and advanced cursor. | Re-throw access failures to gmail_access_error; first pass pauses, no readFailure or cursor movement. RED then GREEN plus both stages through real controller flow. |
| High | Removing initialized DB or restoring pre-reservation DB reopened as ordinary/fresh startup. | Independent epoch/revision guard refuses missing/older DB; DB-ahead guard recovers; marker update must succeed before send permission. Both regressions RED then GREEN. |
| High | Negated/quoted/irrelevant stack mentions and large fullstack platform yielded match. | Conservative ambiguity/complex rules produce review. Five original cases RED then GREEN; independent synthetic adversarial corpus covers positive/mixed/absent-data cases. |
| Critical acceptance gap | Ordinary scheduler and limits per pass did not enforce a single attempt across the whole live procedure. | Separate acceptance pass/bot/entry point, one chosen new ID, synchronous whole-run reservation, no scheduler or technical replies, common persistent ledger. New harness tests first failed because the required mechanism was absent, then passed. |
| Medium | Status lacked completion/next attempt/blocking error and durable review/exclude aggregates. | Fixed safe fields added; timestamp/pause and aggregate regression assertions RED then GREEN. |

No extra concrete High/Critical issue was found by the independent targeted reviewer
after checking discovery/transactions/cancellation and the new guard/acceptance code.
This is source/offline evidence, not a security scanner or live-delivery certificate.

## Consistency assessment

- Cursor: full bounded pagination precedes body work; upper fence uses BigInt. IDs above
  Number.MAX_SAFE_INTEGER, non-contiguous IDs, duplicates and next-pass later events are
  tested. Incomplete pages/overflow/timeout never move cursor. Retry persists in messages
  and keeps cursor fixed, rather than using an independent queue. Three transient read
  failures become terminal read_failed; access errors never consume this budget.
- SQLite: BEGIN IMMEDIATE, unique identities, WAL/FULL, atomic message plus project states.
  Child-process crash tests cover reservation, sent, unknown, baseline and before/after
  checkpoint. Uncommitted WAL transaction rolls back. SQLITE_BUSY leaves no partial state.
- Send: only newly reserved match projects reach genuine private owner notifier. API success
  is needed for sent; all other outcomes are unknown. No automatic resend of unknown or
  recovered reservations. This is not exactly-once delivery or a transport retry guarantee.
- Cancellation: real mocked integration covers off during token, pagination, metadata,
  full and in-flight send; no follow-up requests/card/timer. Before-send cancellation
  settles reservations unknown. Off waits for an already started send to settle, then returns.
  Synchronous SQLite commits cannot interleave with JS shutdown; storage closes after drain.
- Permission: commands remain owner/from + owner/private chat only; restart clears consent
  and destination. No fake runtime context or persisted opt-in was introduced.

## Remaining limitations and recovery

History can expire, including while a retry keeps cursor fixed; explicit recovery decision
is required, not automatic full sync. Initial baseline intentionally excludes prior mail,
and its time floor excludes backdated imports/late preactivation mail and depends on a
correct local clock. Review is not sent: ambiguous good opportunities can be missed.
Terminal parse_failed/read_failed and filtered projects have no replay UI/command;
selective one-ID recovery with preserved tombstones is a separately authorized follow-up.

Guard cannot detect rollback/deletion of the WHOLE state directory including itself, nor
an independent changed path/database. Never roll back guard to make an old backup pass.
OS power loss/disk failure/consistent backups remain operator concerns. PID reuse or
foreign/uncertain session ownership blocks rather than unsafe unlocking; repair needs
proof all monitor processes are stopped and separate maintenance authorization.

Monitoring always OFF after restart; unattended supervision/automatic opt-in is outside
M5. Node 24.1.0 SQLite is experimental and synchronous. Only local disk/single host is
supported; no ORM, service or dependency was added. M5 live behavior remains unverified.

## Publication and live boundary

The publication inventory contains 35 files (8 modified, 27 new), excluding HANDOFF.
Local pattern inspection covered all 35 and detected no token/private-key/literal Gmail-ID
pattern; all new files passed whitespace checks. This does not claim exhaustive secret
detection. .env/private directories/state/guard/WAL/SHM are ignored and not tracked.
package.json and package-lock.json are unchanged; installed dependency tree is valid.
Live instructions are in milestone-5.md: separate metadata-only preparation, then the
manual acceptanceRun entry point with a selected new ID and shared initialized ledger.
Production on/projects are never the one-card acceptance route. No live test was run.

## Final fresh verification

On Node v24.1.0: npm run typecheck PASS; npm test 582/582 PASS (34 files);
npm run lint PASS; npm run build PASS; git diff --check PASS; npm audit 0 vulnerabilities.
These are this adversarial review's runs, not the previous 530-test report.
Offline tests used synthetic mail, mock APIs, fake clocks and temporary databases;
Windows Temp access was granted for the same suite, without changing Vitest behavior.
Local HEAD, cached origin/main and read-only GitHub main are all the supplied baseline
a445dca3085baf67c77d1a42c79a56b1cc720db6. No staging/commit/push was performed.

Verdict: READY WITH WARNINGS for offline pre-commit acceptance. Live M5 delivery is not
certified. Suggested commit: feat: add persistent owner-controlled Kwork monitoring.
