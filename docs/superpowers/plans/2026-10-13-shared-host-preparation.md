# Shared-host preparation implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. The owner authorized local preparation and publication of the original 14 M6 files only. Stop before server writes and publication of this extension.

**Goal:** Prepare a bounded synthetic FirstVDS test alongside FSP without changing the separate-VPS configuration.

**Architecture:** Standalone Compose, published M6 image, dedicated numeric identity, isolated persistent bind, no network or secrets for the first test. An offline probe imports production libraries and exercises bounded synthetic parsing to measure runtime memory; it never imports startup or performs API requests.

**Tech Stack:** Existing Node 24/SQLite, Docker Compose, Linux cgroup v2.

**Spec:** Owner's shared-host preparation request; AGENTS.md; docs/milestone-6.md.

## Constraints and review focus

- Only the exact original 14 M6 paths may enter the authorized commit; preserve all previous edits and private artifacts.
- Do not connect to or modify the server, FSP resources, credentials, real state or baseline.
- CPU 0.25; RAM selected from measured offline runtime; memory+swap equals RAM.
- Synthetic mounts must refuse missing paths, nonempty seeding and absent fixture markers.
- Numeric UID/GID must differ from fspdeploy 1000; reject an occupied proposed host identity.
- Keep base Dockerfile/Compose unchanged. No socket, ports, FSP networks/volumes or application behavior changes.
- Measurements establish offline headroom only; real network operation and FSP peak coexistence remain unverified.

## Task 1 — publish base M6

- [x] Compare local HEAD with GitHub and remote main; inspect the exact staged 14-file diff and run checks.
- [x] Commit and normal push only if remote is unchanged; verify published SHA independently.

## Task 2 — prepare and locally verify isolated test

Create deploy/compose.firstvds-test.yaml, deploy/firstvds-test.env.example and deploy/shared-host-probe.mjs; add future-only deploy/compose.firstvds.yaml and deploy/firstvds.env.example. Export the published SHA to a new ignored scratch directory and build its image there; new probe/config are mounted separately, not baked into that release.

- [x] Measure loaded production libraries plus bounded MIME/parser/classifier workload without credentials/network; select RAM with reserve.
- [x] Validate standalone Compose and inspect actual CPU/memory/swap/security/mount settings.
- [x] Seed only a fresh marked fixture; verify baseline, guard, dedup and rights after restart/recreate and graceful SIGTERM.
- [x] Compare pre/post inventory of unrelated containers, networks and volumes; remove only resources created by this test.

## Task 3 — runbook and review

Create docs/m6-shared-host-test.md with prerequisites, image transfer without VPS build, unique directories, observation thresholds, exact cleanup and future stopped-state migration.

- [x] Document image archive/hash/architecture gates, separate identity and shell commands that never expand secret files.
- [x] Document RAM/CPU/swap/FSP health stop rules and narrow resource cleanup; distinguish synthetic test from permission for a real poller.
- [x] Run Codex Security review of new files; verify preservation and final Git scope. Leave this extension uncommitted and stop before server changes.

## Execution evidence and rulings

- Base M6 published as ed41279a85c1fe0d78a3cbd85b20a9856e8b8c15 (exact14 paths); extension uncommitted.
- Ruling: RAM384 MiB rather than256 — observed loaded runtime RSS peaks212..223 MiB, leaving256 too close to observed demand; cost is less shared-host reserve and a stricter observed short test.
- Initial sandbox test run failed temp-cache/SQLite accesses; unsandboxed offline repeat599/35 passed, lint/build passed. No application fix.
- Separate future override retains base deployment gate and existing local startup; synthetic standalone disables network and has no env_file/build.
- All smoke/restart/recreate/permissions/resource checks passed. Own Docker test resources removed; existing15 containers/network/volume inventory unchanged.
- Fresh review found one minor operator-window ambiguity; clarified absolute120s smoke deadline unaffected by restart. No Critical/Important findings.
- Full image scan: no forbidden private paths; three Google declaration PEM header comments are verified documentation, no unresolved credential patterns.
- Detailed runtime evidence and untested live boundaries are in docs/m6-shared-host-test.md.
