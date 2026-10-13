# M6 final adversarial review and ENV management plan

> **For agentic workers:** Use superpowers:executing-plans inline; independent final review is required. The owner's detailed request authorizes local implementation and fixes. No commit, push, SSH, real credentials, real state changes or live bot/API calls.

**Goal:** Prove the synthetic FirstVDS preparation boundaries and give the owner safe, repeatable ENV operations.

**Architecture:** Keep existing Compose and config loaders. Add one pure ENV validator/CLI and a standalone network-none validation service with no state mount. Document private file editing, validation before any ENV injection, one-container stopped recreation and private rollback. Harden only confirmed deployment defects.

**Tech Stack:** Node24/TypeScript/node:sqlite/Vitest, existing Docker Compose raw env_file, Docker Linux cgroups.

**Spec:** Owner's Final Adversarial Review & Safe ENV Management attachment; AGENTS.md; current M6/shared-host files.

## Boundaries and readiness

- Preserve five previous Gmail/test edits, HANDOFF, private SSH report and every real state/secret file; never print values.
- Distinguish published ed41279 source, scoped candidate (published source plus final M6 paths), and full working tree.
- Synthetic check service: no network, state, startup, OAuth construction, poller or scheduler.
- ENV lexical contract is a strict subset of Compose raw: UTF8, LF/CRLF, one explicit key=value per allowed key, no duplicates/export/bare inherited names, no control bytes or misleading surrounding whitespace. Interior $/#/quotes/spaces remain literal.
- Compose settings use a separate nonsecret file with literal absolute Linux paths and explicit release SHA; no ambient interpolation or runtime credentials.
- Every operation targets the exact Kwork project/service; stop and prove exit before recreate, never concurrently run old/new pollers. Monitoring remains OFF.
- READY means local preparation for a short synthetic server test only. Server capacity, live credentials and real migration remain unverified.

## Task 1 — adversarial evidence before fixes

- [ ] Reverify GitHub/remote/main/status and preserve existing files by hashes. Use Context7/official source for actual raw ENV and restart semantics.
- [ ] Reproduce confirmed schema-shape gate gap and pipeline failure masking on synthetic data; record the UID checker mismatch.

## Task 2 — minimal implementation

Create src/ops/configCheck.ts, src/ops/configCheckRun.ts, tests/deploymentConfig.test.ts and deploy/compose.env-check.yaml. Modify deploymentState/start/tests only for proven preflight failures, .gitignore for ENV backup suffixes, and shared runbook for exact UID and failure propagation.

- [ ] Watch failing regressions, implement pure validation with fixed codes and no values, and cover missing/empty/specials/CRLF/wrong file kind/placeholders/limits.
- [ ] Reject incompatible table columns before polling. Validate runtime settings before state/startup. Preserve local startup/M5 business logic.
- [ ] Add ENV owner runbook and adversarial failure matrix, including private backups, rollback and revoked-token limits.

## Task 3 — scoped Docker and full checks

- [ ] Build published release and scoped candidate in new ignored scratch. Run separate suites and all requested working-tree checks.
- [ ] Test actual Compose raw injection, special characters/CRLF, invalid paths/permissions, safe suppression of parser errors, restart versus recreate, and offline check without network/state.
- [ ] Repeat synthetic resource/permission/state/SIGTERM and guard/schema tests; verify context/image layers and delivery exclusions.
- [ ] Test controlled OOM and full storage only in own synthetic limited resources, never stress VPS/FSP.
- [ ] Remove only newly created labeled resources; compare unrelated Docker inventory and original file hashes.

## Task 4 — final review and report

- [ ] Freeze final files before new scoped Codex Security scan; resolve confirmed issues, then report exact coverage and limits.
- [ ] Record per-scenario protections/evidence/remaining limits, exact commit allowlist and final Git status. Stop before publication/server permission.

## Decisions

- Ruling: small validator is necessary because Compose schema checks alone do not reject missing/empty application settings, duplicated keys or leaked parser-error lines. It validates a deliberately documented raw subset, not a replacement dotenv API.
- Ruling: user already provided purpose, constraints and implementation authorization; generic design approval/commit gates are not added to this local task.
