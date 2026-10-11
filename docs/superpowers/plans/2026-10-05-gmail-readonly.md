# Gmail READ ONLY Implementation Plan

> For agentic workers: use superpowers:executing-plans for inline execution.

**Goal:** Independent, safe local Gmail metadata smoke check.
**Architecture:** Separate Gmail configuration, verified readonly API boundary,
exact subject search and CLI. The Telegram dependency graph remains unchanged.
**Tech stack:** Node.js, strict TypeScript ESM, googleapis, Vitest.
**Spec:** `docs/superpowers/specs/2026-10-05-gmail-readonly-design.md`.

## Global constraints

Required readonly scope; allow non-Gmail scopes, reject unknown or mutating Gmail
permissions. Check account before message operations. Metadata only. No secrets,
local `.env` reads by agent, live API tests, commits, pushes or new milestones.
User explicitly authorized continuing after spec/plan without another approval.

## Review focus

Extra scopes, mismatched/missing account, ambiguous Subject, broken pagination and
raw OAuth errors must fail safely. Tests belong to tasks 1/2; bounded sample must
not be described as total count or globally newest messages in documentation.

## Tasks

### Task 1: Gmail configuration

- [x] Write `tests/gmailConfig.test.ts` for required values, blank/placeholder
  rejection and email validation, with synthetic data only; run and observe RED.
- [x] Implement `loadGmailConfig(env?: NodeJS.ProcessEnv): GmailConfig` in
  `src/config/gmail.ts`, reusing ConfigError; run task tests to GREEN.
- [x] Add four safe placeholders to `.env.example`.

### Task 2: Verified client and subject search

Consumes GmailConfig. Produces `createGmailClient(config): Promise<GmailClient>`
with only list/get metadata methods and `findKworkEmails(client): KworkEmail[]`.

- [x] Install googleapis, updating package.json/lock only.
- [x] Write fake-boundary tests for OAuth scope/profile ordering and sanitized
  errors; write search tests for exact Subject, absent data and page bounds. RED.
- [x] Implement `src/gmail/client.ts` and `src/gmail/kworkEmails.ts` according to
  spec. Return only metadata, enforce bounds, GREEN.

### Task 3: Smoke CLI, documentation and review

- [x] Add a subprocess test for missing Gmail config with a fully synthetic,
  explicitly supplied environment and no env-file loading; observe RED.
- [x] Implement `src/gmail/check.ts` and gmail:check npm script. GREEN.
- [x] Update README and AGENTS, inspect only source/example files for secrets.
- [x] Run all prescribed checks and Codex Security review when available;
  dispatch a fresh whole-change reviewer, address substantive findings with tests.
- [x] Final Git status and report; leave implementation uncommitted for owner.

## Execution ledger

Ruling: use the owner's current workspace for the requested manual acceptance;
no Git branch/worktree/commit mutations. Record RED/GREEN and progress here rather
than commit-dependent scratch scripts, since the owner prohibited commits.
Pre-flight: task 2 consumes GmailConfig from task 1; task 3 consumes the verified
GmailClient and KworkEmail[] from task 2. No interface conflict found.
Task 1: configuration RED (missing module) -> GREEN, 15 tests passed.
Task 2: API/search RED (missing modules) -> GREEN, 32 tests passed.
Ruling: load googleapis lazily after config validation to avoid SDK startup before
early config errors. Extract smokeCheck from CLI for stable mock tests without
Vitest module-cache invalidation; same command/output, no scope expansion.

Task 3: CLI RED (missing module) -> GREEN, 3 tests passed. Full suite: 80 tests
in 7 files passed, including all 30 existing Telegram/config tests.
Validation: typecheck, lint, build, npm audit (0 vulnerabilities), diff whitespace
and env ignore checks passed. Full tests passed outside the sandbox after transient
ENOENT errors in Vitest's temporary SSR cache inside the sandbox. No test was
weakened and no live Gmail/Telegram calls or local secret-file reads occurred.
Fresh whole-change review: no substantive findings. Codex Security diff scan
53bbf7e8-e218-49a4-92ed-41780b8579dc completed with 6 changed executable/package
surfaces reviewed and no confirmed findings; live OAuth grants remain unverified.
Source/example secret-pattern check: no credential-shaped matches. Git changes
remain unstaged and uncommitted on main for the owner's manual acceptance.
