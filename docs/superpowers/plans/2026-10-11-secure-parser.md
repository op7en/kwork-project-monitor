# Secure Kwork Parser Implementation Plan

> For agentic workers: apply superpowers:executing-plans task by task; main agent owns all edits. Three read-only domain agents research/review independently.

Goal: finish Milestone 3 with the approved MIME/reader foundation and the owner-confirmed Kwork table adapter.
Architecture: existing OAuth identity gate → separate metadata/full reader → MIME text representations → explicit format/URL policy → per-block extraction and batch deduplication.
Tech stack: Node.js/strict TypeScript/ESM, googleapis, node-html-parser, Vitest.
Spec: ../specs/2026-10-11-secure-parser-design.md

## Global constraints

No .env reads, repeat real email acquisition, unsafe diagnostics, Gmail mutations, Telegram changes, F1/F2/F3 fixes, commit/push/PR or Milestone 4. Owner-confirmed public table/URL semantics are binding; original private fixture remains ignored. Synthetic extensions do not prove unseen template compatibility.

## Review focus

- MIME limits apply to aggregate content and attachment/forwarded subtrees cannot become projects.
- From/header ambiguity and metadata/full mismatch prevent unverified body use.
- Duplicate/conflicting fields cannot silently overwrite another card's data.
- HTML entities, invisible controls and URL normalization cannot bypass direct-link policy.
- Missing/unsupported real format is reported rather than inferred.

## Tasks (owner approved; main agent owns all edits)

- [x] 1. Domain, URL policy and MIME. Write tests first for valid literals and corrupt/adversarial cases; run failing tests; implement src/kwork/model.ts, src/kwork/url.ts and src/gmail/mime.ts; verify focused tests.
- [x] 2. Block parser. Write labelled synthetic HTML/text fixtures and expectations first; observe failures; implement src/kwork/parser.ts for within-card fields, budget variants, optional stats, ambiguity rejection and local dedup; verify focused tests.
- [x] 3. Gmail reader and orchestration. Add offline API-boundary tests before changing src/gmail/client.ts; preserve existing GmailClient contract, factor only shared verified authentication and add separately gated reader. Add src/gmail/projects.ts and end-to-end offline tests. Do not run live Gmail.
- [x] 4. Offline CLI and docs. Add parser:check with no .env loading, token or network. Run subprocess with empty environment against synthetic fixture. Update README/AGENTS for Milestone 3 boundaries and unknown real-format acceptance.
- [x] 5. Independent reviews. Return completed sources to A/B/C, resolve confirmed defects with regression tests, execute separate Codex Security changed-code/dependency scan including untracked files.
- [x] 6. Final checks. Run typecheck, full tests, lint, build, audit, parser:check, diff --check, status and secret-only location scan. Report all executed evidence, coverage gaps, scan identity and exact owner sample request. Stop without Git publication.


## Historical synthetic execution evidence

Owner approved the spec/plan in chat. Main agent made all edits; domain agents performed independent read-only research and review. No Git publication or live Gmail. Red/green cycles verified MIME/URL, parser, reader, CLI and every confirmed review regression.

Final verification: 231 tests / 13 files passed; typecheck, lint, build, npm audit (0 vulnerabilities), parser:check (2 synthetic projects, no diagnostics), diff --check passed. Baseline HEAD remains 782da2567850003155873d9eca2508edad333a18.

Codex Security scan 8f187623-0426-488f-9f3a-c03e11e9c75a completed for its original working-tree snapshot with one medium/P2 CWE-400 finding. The host reported snapshot drift from non-executable lint comments/test formatting. After sealing, local repeated-label accumulation was bounded to two recognized values; an ETIMEDOUT regression became green and the security worker independently verified the fix. Sealed finding remains unchanged; no new zero-finding scan is claimed.

Ruling: MIME must retain independent mixed segments separately from alternatives; representation selection uses unique project count. Titles come from validated project anchors in one heading. Unknown production sender/format/URLs remain unconfirmed. Limits bound processing, not streaming downloads. Budgets support explicit integer RUB values; actual format acceptance awaits an anonymized source email.

## Owner-authorized observed-table adaptation

Confirmed by the owner: exact header cells Название / Покупатель / Цена, direct three-cell project row, title link plus below-title description/category, buyer with signed statistics, integer RUB notification price, and HTTPS kwork.ru/new_offer?project=<positive decimal ID>. The privately sanitized source is permitted for local acceptance only; no publication.

- [x] Restore public project path in ignored fixture; validate consistency/privacy locally.
- [x] RED literal synthetic table/URL assertions; minimal discriminated policy extension, row-local adapter, price/details/exchangeProjects optional fields. Retain synthetic-v1.
- [x] GREEN URL adversarial cases, optional absences, row/header boundaries, provenance/dedup, MIME integration, empty-environment CLI and bounded repeated-statistics stress test.
- [x] Independent A/B/C review; RED→GREEN confirmed malformed duplicate/substring statistics and obfuscated CSS regressions.
- [x] Initial final typecheck/tests/lint/build/parser/audit/diff/status: 306 tests / 15 files; all commands passed, npm audit 0 vulnerabilities. Local sanitized fixture: one project, expected synthetic price/statistics/provenance, no diagnostics. Telegram source paths unchanged.
- [ ] NEW Codex Security scan of immutable final patch; old scan is not final evidence. Final scan identity/findings are reported separately to avoid changing the sealed patch.

Rulings: Цена is stored as price, not desired/maximum budget. Description/category share details until their individual boundary is confirmed. Stats use exact structured lines and count captions before values. CSS comments/escapes are conservatively omitted with their subtree instead of interpreted. Missing outer wrappers may be recoverable; collapsed row cells are rejected. Real plain-text grammar is unconfirmed and disabled under this policy. Canonical direct URLs admit only the single project parameter; no extra tracking/redirect keys.

Follow-up: scan 90be622e-dd8c-4edb-89cf-6c2a4242d356 reproduced a malformed encoded-padding CPU defect. It was suppressed as a security finding because Google controls canonical envelope encoding and no arbitrary envelope entry point exists, but malformed-input robustness still required correction. RED bounded subprocess timed out at 3 seconds; MIME now validates alphabet/padding first and strips at most two suffix characters with bounded string operations. Final follow-up verification includes the 307th regression and a new immutable scan; the preceding scan is not evidence for this corrected version.
