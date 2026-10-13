# M6 final adversarial review — 2026-10-13

Scope: опубликованный base `ed41279a85c1fe0d78a3cbd85b20a9856e8b8c15` плюс отдельно
подготовленные shared-host/ENV changes. Все проверки local/offline/synthetic. Нет
SSH, VPS writes, real poller/Gmail, acceptance, monitoring activation, secret reads,
реального переноса или изменения ledger/guard/WAL/SHM. Commit/push не выполнялись.

## 1. Подтверждённые дефекты и исправления

| Дефект | Evidence | Исправление |
| --- | --- | --- |
| user_version/quick_check не доказывают совместимость формы схемы | Переименование columns и добавление extra columns в4 таблицах проходили прежний gate; RED наблюдался | Gate сравнивает count/order/type/nullability/PK по PRAGMA table_info и STRICT по table_list; READ ONLY, no repair;8 regressions |
| Shared state21001/0700 недоступна checker image default1000 | Default checker отказался deployment_state_missing, explicit21001 вернул OK на той же synthetic fixture | Точная shared migration command с --user21001 и independently retained CURRENT guard |
| set-e не ловит producer error в pipeline | false piped into successful consumer продолжал script | Snapshot producers ||return1, direct private redirects; confirmed failure propagation |
| *.env не покрывает bot.env.bak/backup/editor suffix | git check-ignore до/после rules | Добавлены *.env.*, *.env~; public *.env.example остаются разрешены; build allowlist unchanged |
| Shared override наследовал build | Merged model build present=true | build !reset null, pull_policy never; merged build отсутствует; base Compose unchanged |
| Нет отдельной безопасной ENV/app проверки | Compose schema не проверяет6 required keys/app limits; malformed raw key печатается в stderr даже при --quiet | Pure CLI file/runtime validator + offline standalone service; raw errors подавлены в owner procedure |

Новую схему, БД или baseline не создавали для восстановления существующей установки.
Синтетический seed создаёт только marked fixture и отказывается от непустой директории.
M5 business logic и local index startup не менялись; усилен только deployment entrypoint.

## 2. Проверенная архитектура ENV

`src/ops/configCheck.ts`: документированный строгий subset raw ENV, whitelisted keys,
explicit key=value, no duplicates/bare inherited names/export/control/BOM, bounded
UTF8 file/value, missing/empty/placeholder rejection, существующие config loaders.
Внутренние dollars/hash/quotes/spaces literal. Compose settings отдельно: SHA40 и
literal absolute paths/digest. Синтаксическая проверка не доказывает authentication.

`configCheckRun.ts`: file mode проверяет regular/root-owned0600 и UTF8, выдаёт только
fixed codes. File-check запускается до ENV injection, чтобы ошибочный NODE_OPTIONS
не применился раньше Node validator. `deploy/compose.env-check.yaml`: без сети,
state mount, ports, build, polling, restart, Docker socket и SDK construction.

Owner workflow: private staging + paired ENV backup, actual Compose raw check,
stop/verify one current process, state check, atomic runtime file replacement,
one-service force-recreate with no-deps/no-build/pull never, проверка OFF. Возврат
ENV не откатывает SQLite; revoked credentials не становятся действительными от rollback.
Точные команды: `docs/m6-env-management.md`.

## 3. Failure matrix

Статусы: **TESTED** — воспроизведён offline; **STATIC** — source/model/процедура проверены;
**LIVE GATE** — нужен будущий разрешённый сервер/API этап, сейчас не утверждается PASS.

| Сценарий | Конкретная защита/проверка | Evidence / предел |
| --- | --- | --- |
| Missing/empty required ENV |6 names checked before startup; values never errors | TESTED unit + actual Compose missing injection |
| Placeholder/invalid owner/account/limits | Existing loaders and fixed error | TESTED unit/file/container; auth remains LIVE GATE |
| $, #, spaces, quotes, equals | Compose raw keeps interior bytes; no inline comment/wrapper quote semantics | TESTED actual byte-equality oracle |
| CRLF | Accepted line endings; embedded CR/control forbidden | TESTED file validator + actual Compose oracle |
| BOM/malformed UTF8 | Fatal decode / fixed rejection | TESTED CLI/root file mount |
| Duplicate/bare/export/unknown keys | Reject before injection, including NODE_OPTIONS/monitor ENV opt-in | TESTED lexical cases |
| Compose/runtime files mixed | Separate allowlists; no secrets in Compose settings | TESTED wrong-kind input |
| Wrong ENV path | Required file, explicit bind; no host path creation | TESTED Compose missing-file failure |
| Insufficient file permissions | root0600 regular contract; unprivileged reader refused | TESTED Linux UID21001 EACCES/fixed unreadable; Windows parsing and Linux rights tested separately |
| config/diagnostics disclose values | Quiet alone insufficient; owner masks both streams, helper fixed errors | TESTED raw bad-key stderr echo and fixed-status adapter; no real secrets involved |
| Secrets in image/context/delivery | Build from scoped archive, allowlist, exact package file list, ignored backups | TESTED actual context55 files and layer scan; no env in runtime |
| ENV edit + ordinary restart | Container ENV fixed at creation | TESTED old version persists after restart |
| Correct stopped recreate | Only own bot, same current state, no-deps | TESTED new version applied and mock monitor OFF |
| Endless restart on bad config | Shared restart=no; prevalidation before swapping | TESTED invalid validator exit, STATIC shared policy. Base separate-VPS unless-stopped can loop: stop explicitly |
| Recreate activates monitoring | No ENV opt-in, controller defaults disabled, destination process-local | TESTED controller oracle/smoke; live private commands unrun |
| Second token poller | Offline validator never polling; fixed bot name/project + prove old exit | TESTED one mock process at a time. Other hosts cannot be detected by local Docker: owner LIVE GATE |
| Revoked Telegram token rollback | Do not promise old backup restores revoked token | STATIC recovery plan; real rotation/auth not attempted |
| Invalid Gmail refresh token | Syntax only; existing READ ONLY scopes/account checks when authorized | STATIC + published mocked tests; real grant validity LIVE GATE |
| Container exceeds RAM | Kernel limit + swap0; no automatic retries/limit increase | TESTED isolated32MiB OOMKilled=true/exit137.384MiB workload separately passed |
| UID21001 occupied | getent checks before user/group creation; STOP, no reassignment | STATIC command; actual VPS identity availability LIVE GATE |
| Wrong state directory | Absolute bind, exact operator mount inspection, state/binding gate | TESTED missing/incompatible/foreign-bound state; same-account old complete pair still needs CURRENT guard |
| Source directory absent | bind create_host_path=false | TESTED missing bind refused, no implicit DB creation |
| Filesystem full | SQLite transaction/guard error refuses reservation; no reset | TESTED own1MiB tmpfs ENOSPC, files retained, deployment gate blocked. Host SSD fullness not tested |
| Memory/disk exhausted on VPS | Preflight and observation thresholds; stop only test | LIVE GATE; local faults cannot prove host-wide availability |
| Unexpected SIGKILL | Dirty/orphan session blocks deployment, no automatic unlock | TESTED owned synthetic killed process -> deployment_state_busy |
| Clean SIGTERM | init/exec,90s drain, close storage before checker | TESTED exit0/OOMfalse and checker after restart/recreate |
| FSP grows during test | MemAvailable/CPU/PSI/swap/health stop rules, owner observer | LIVE GATE; no current server load experiment |
| DB/guard mismatch | epoch/revision exact equality | TESTED ahead/behind/epoch/malformed refusal, no modification |
| Missing baseline | Existing history/floor required | TESTED refusal; no capture/reset |
| WAL omitted | DB may remain older than guard | TESTED deliberate incomplete synthetic copy fails; full stopped source passes |
| Session lock | Session must be empty before deployment | TESTED occupied/foreign/orphan fixture |
| New empty DB accidentally created | Gate requires existing DB+guard before polling import | TESTED both/one missing fail; source does not initialize |
| Repeated seed | Empty-directory assertion and synthetic marker | TESTED nonempty refusal without reset |
| Old backup | Compare to independently retained CURRENT guard; preserve latest state for image rollback | TESTED high-water refusal. Complete directory+guard rollback without external reference is not detectable |
| Old app/new DB schema | Exact v1 contract, fail on wrong version/shape | TESTED schema version99/renamed/extra columns; future unknown release versions LIVE GATE |
| FSP network/volume/socket/ports | Own Compose, networknone synthetic, only own bind | TESTED actual config/runtime metadata; no FSP resources connected |
| Compose project flag omitted | YAML name defaults Kwork; fixed real bot name; CLI explicit project | STATIC model. Operator arbitrary override still requires label/prefix checks |
| Cleanup targets wrong project | Prefix/service checks before down; no global prune/remove-orphans | STATIC hardened procedure + actual own-resource cleanup; operator can deliberately bypass procedure |
| VPS build starts accidentally | Shared model has no build and pull never | TESTED merged model, no build executed on VPS |
| Synthetic uses real credentials/network | Standalone smoke has no env_file/network; check uses only known fixtures | TESTED networknone/no socket; root real credentials never supplied |
| Destructive operation without permission | No SSH/server mutations/commit/push; only labeled local fixtures | TESTED preservation/inventory; future server writes require owner approval |

## 4. Fresh verification results

| Target | typecheck | tests | lint | build |
| --- | --- | --- | --- | --- |
| Published ed41279, Linux Node24 | PASS |598 /35 files | PASS | PASS |
| Scoped candidate: published source + M6 fixes, excluding old five edits | PASS |628 /36 files | PASS | PASS |
| Full working tree including old user work | PASS |629 /36 files | PASS | PASS |

`npm audit`:0 vulnerabilities. Initial new validator type narrowing failure fixed;
initial Linux verification command applied V8 heap only to first command, so subsequent
build ran into default heap. Corrected verification heap, repeat builds PASS. Compilation
uses2560MiB/heap1792, never a VPS operation; runtime cap remains384MiB.

Actual ENV integration passed lexical and raw special/CRLF cases, fixed rejection,
ordinary restart old ENV versus stopped recreate new ENV, mock OFF. Wrong Linux
VM env path on Windows Compose client was a fixture error; corrected to Windows
synthetic files for client parsing while Linux ownership tests stayed separate.
First immediate crash log check raced readiness; corrected bounded readiness wait,
then actual SIGKILL/orphan test passed. These failed probes are not reported as PASS.

Final candidate is **unpublished**, local tag `m6-final-candidate-fc022649`, compiled
from a new scoped copy, not from arbitrary current uncommitted Gmail changes. It must
not be relabeled as a Git SHA or deployed as a published release. The old ed41279
delivery remains historical; after approval publish final changes, rebuild Git SHA
with revision label and create a new checksum delivery package before server test.

Resource probe under384MiB/CPU0.25/swap0: RSS peak214192KiB (~209.2MiB), cgroup peak
220172288 bytes (~210.0MiB). It loads libraries and bounded synthetic parsing; it is
not real network runtime or proof of FSP peak coexistence. Selected cap unchanged.

Final fresh scoped Codex Security report is kept outside Git and linked in the task
answer. Freeze source/docs before scan; do not substitute the earlier snapshot report.
No vulnerability conclusion is inferred from test count or npm audit alone.

## 5. Readiness and remaining approval gates

Local preparation permits a **READY** verdict only after all listed checks, final
security review and preservation pass. READY is for publication and the next short
synthetic stage; it is not production readiness or permission for server writes.

Before FirstVDS: approve final20-path scope, commit/push, exact resulting release SHA,
new image/manifest, host/run ID/identity/directories, Sava's test window and narrow
cleanup. Fresh server preflight and observer mandatory. No real token/poller/state
transfer is included in synthetic permission; each needs its own explicit approval.

Unverified: actual peak FSP/host behavior, UID availability, VPS permissions/filesystem,
reboot/power loss, live tokens/scopes/profile/history, real migration and notifications.
Gmail/Telegram credentials and ENV backups are accessible to host root/Docker admins;
organizational trust is required. No local cgroup test removes these boundaries.
