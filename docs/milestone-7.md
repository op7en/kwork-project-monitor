# Milestone 7 — Product Reliability

Verification date: 2026-10-14. Local synthetic verification only. No commit, push,
FirstVDS access, production ENV/state changes, real Gmail or Telegram calls.

Base: `3a77a999670a8d5a7386552bf591db060ce38e50`, equal to local HEAD,
origin/main and GitHub main when checked. This is the published M6 baseline.

## Scope and existing work

Stage A: match/review delivery, Russian review reasons, four normalized price
kinds, permissive unknown inline CSS, local row failure isolation, soft send
budget between messages. Existing reservation/tombstone semantics remain.

Stage B: persisted owner-bound opt-in, baseline-dependent restore, runtime
bootstrap/recovery gate, strict transfer/CURRENT gates retained, bounded alerts,
approved scalar diagnostics, five-minute default and FirstVDS restart policy.
SQLite schema remains user_version=1; enabled lives in meta.

Integration added coverage in existing monitorFlow tests and existing offline
smoke harness (`--m7`). No new src module. A confirmed Windows EPERM on atomic
guard rename required one additional fix in ledgerGuard: at most ten rename
attempts, 20ms apart, only win32 EPERM/EACCES. DB transactions and Telegram sends
are never retried by this mechanism. The existing guard is never unlinked.
Fault injection demonstrated failure before the fix and successful bounded
handling afterward, including permanent failure preserving the old guard.

The five pre-existing Gmail/test edits are a separate metadata-only acceptance
preparation task, not a production-pass integration. They remain in the working
tree and are excluded from the M7 staged candidate:

| Existing file | Excluded WIP | Included M7 change |
| --- | --- | --- |
| src/gmail/client.ts | checkMessageMetadata implementation | Safe diagnostics; fresh currentHistoryId contract |
| src/gmail/monitorClient.ts | Required checkMessageMetadata interface member | None |
| tests/monitorAcceptance.test.ts | Metadata mock field | None |
| tests/monitorGmail.test.ts | Metadata-only candidate-gate test | Fresh history fence assertions |
| tests/monitorPass.test.ts | Metadata mock field | match/review delivery expectations and reasons |

The production reader retains its own metadata Subject/From/size/floor gate
before full body. The unused metadata helper is not required for M7. Live M5
acceptance preparation remains unfinished; no ignored helper or acceptance data
is included. HANDOFF-ANTIGRAVITY.md and the private SSH audit are excluded and
their bytes were preserved.

## Evidence

| Check | Result |
| --- | --- |
| Full working tree Vitest, including metadata WIP | 709/709, 40 files |
| Isolated scoped candidate Vitest | 708/708, 40 files; excludes one metadata WIP test |
| typecheck, lint, build | PASS in working tree and scoped candidate |
| npm audit | PASS, zero vulnerabilities; package-lock unchanged |
| git diff --check | PASS |
| 11 and 30 eligible rows + malformed row | All eligible projects delivered; no message-wide rejection |
| match/review + prices | Correct owner, review reasons, fixed/up-to/from/range |
| Restart and new mail containing old project IDs | Zero duplicate cards; sent tombstones retained |
| Persisted ON / OFF / no baseline | ON restored; OFF stays OFF; bootstrap does not create baseline |
| Gmail history404 PAUSE | Persisted OFF and exactly one alert; no scheduler retry loop |
| Fresh upper fence | Separate currentHistoryId after connect; different profile snapshots tested |
| State refusal | Foreign binding, missing DB/guard member, DB behind guard, gap>1 and CURRENT rollback rejected |

Production image: `kwork-project-monitor:m7-scoped-candidate`, built from the
isolated scoped candidate, not the old published source tree. Final local image
ID: `sha256:23c7d99b32a593c2f387411380430ef81fd7e98a01e363fb5fa215e79b7d92ad`.
This local candidate tag is not a published Git release SHA.

Docker tests used only own temporary synthetic directories, network_mode=none,
mock API adapters and an intercepted Bot.start for actual ops/start entrypoint
checks. No real Telegram poller was started.

| Docker/Compose check on scoped image | Result |
| --- | --- |
| Existing M6 offline smoke | offline_smoke_ok |
| M7 seed, 30 projects, 15 review, four prices, malformed row | m7_offline_ok |
| Recreate with persisted ON | Restored; no new sends |
| Same-process and separate child-process concurrent open | storage_busy, active writer retained |
| SIGKILL then recreate with same PID/hostname, DB-ahead=1 and orphan reservation | Exit137 then successful recovery; orphan unknown; zero resends |
| SIGTERM drain | m7_offline_ok, exit0, strict state gate passes |
| Explicit OFF then recreate | Disabled; no Gmail connect |
| Actual ops/start, clean and OFF fixtures, Bot.start intercepted | bot_ready, monitor_result disabled, mock startup succeeds; clean directory unchanged |
| M6 raw ENV validator | env_configuration_ok |
| Production Compose resolution only | UID21001, restart unless-stopped, read-only, CPU0.25, memory/swap384MiB, pids64 |
| Existing shared-host resource probe | shared_probe_ok; UID/GID21001; RSS peak219704KiB; cgroup limit402653184B; swap0; CPU25000/100000 |

Reproduce the new offline container harness using the existing synthetic Compose
file with an explicit local candidate image tag and a new empty own state
directory. Run `node deploy/offline-smoke.mjs --m7 --seed --state-dir /app/.local-state`.
Subsequent runs omit seed. To test crash recovery, use a fixed synthetic hostname
and `--hold-reservation --db-ahead --wait-for-signal`, wait for
`m7_offline_signal_ready`, kill that own test container, then recreate with
`--expect-same-pid`. Never point this harness at real state. The production
Compose was resolved for validation only; no production service was created.

## Review and limits

GitHub confirmed published M6. Context7 documentation checked Node SQLite/
process semantics, grammY lifecycle and Gmail history expiration. Superpowers
verification and regression workflow were applied. Codex Security completed
the original 20-file runtime/deploy diff and a separate immutable guard-only
delta: no findings, complete scoped static coverage. Removing the unrelated
metadata WIP adds no new runtime control; the retained final subset was checked.
Scan IDs: `6aaa41b5-bc70-4774-8270-ac07f5f76efc` and
`82d12c82-c9ca-478c-83cb-846eb35570b8`.

This is READY for publication and a separately authorized limited synthetic
deployment. It is not production acceptance. Telegram failure can prevent an
alert; orphan reservations remain terminal delivery_unknown to avoid duplicates.
One deployment/writer is assumed; no cross-container singleton guarantee across
independent PID namespaces or filesystem aliases is claimed. Expired Gmail
history still requires explicit baseline confirmation; no automatic backlog skip.

## Exact future commit files

The following list is the scoped candidate, relative to the repository root.

```text
.env.example
AGENTS.md
README.md
deploy/bot.env.example
deploy/compose.firstvds.yaml
deploy/offline-smoke.mjs
docs/milestone-7.md
src/bot/bot.ts
src/bot/projectFormatter.ts
src/bot/projectNotifications.ts
src/config/monitor.ts
src/filters/projectFilter.ts
src/filters/rules.ts
src/gmail/client.ts
src/index.ts
src/kwork/inlineVisibility.ts
src/kwork/model.ts
src/kwork/parser.ts
src/monitor/controller.ts
src/monitor/ledgerGuard.ts
src/monitor/pass.ts
src/monitor/runtime.ts
src/monitor/store.ts
src/ops/deploymentState.ts
src/ops/start.ts
tests/deploymentConfig.test.ts
tests/deploymentState.test.ts
tests/gmailClient.test.ts
tests/gmailReader.test.ts
tests/inlineVisibility.test.ts
tests/kworkTable.test.ts
tests/ledgerGuard.test.ts
tests/monitorBot.test.ts
tests/monitorConfig.test.ts
tests/monitorController.test.ts
tests/monitorFlow.test.ts
tests/monitorGmail.test.ts
tests/monitorPass.test.ts
tests/monitorStartupRestore.test.ts
tests/projectFilter.test.ts
tests/stageADelivery.test.ts
tests/stageBRecovery.test.ts
tests/telegramFormatter.test.ts
tests/telegramNotifications.test.ts
```
