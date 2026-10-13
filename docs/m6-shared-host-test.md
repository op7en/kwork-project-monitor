# M6: ограниченный тест на общем FirstVDS

Подготовка локальная. Этот документ **не разрешает серверные изменения**.
Исторический delivery для ed41279 не содержит финальных ENV/schema fixes. Перед новым
серверным тестом опубликовать одобренные final changes, собрать новый Git SHA и новый
delivery manifest. Локальный candidate не является опубликованным release.
Базовый сценарий отдельного VPS в `docs/milestone-6.md`, Dockerfile и compose.yaml сохранён.
Не выполнять на общем хосте установку Docker, обновление пакетов, настройку firewall,
Caddy или инструкции подготовки чистого VPS из базового документа.

## 1. Решение и ограничения

Уже выполненный read-only аудит показал 1 vCPU, 1799 MiB RAM, примерно 1077 MiB
MemAvailable и четыре работающих контейнера FSP. Это краткий снимок, не проверка пиков.
Swap представлен zram: его логическая ёмкость не является дополнительной RAM.

Для временного теста выбраны CPU 0.25, RAM **384 MiB**, memory+swap **384 MiB**
(дополнительный swap запрещён), PIDs 64, tmpfs 16 MiB, логи 2 MiB × 2.
Не повышать лимиты FSP. При достижении лимита бот может быть убит OOM; это не повод
очищать SQLite или автоматически увеличивать RAM. CPU quota ограничивает процессорное
время, но не резервирует ядро и не изолирует disk I/O, page cache или kernel.

Локальный probe загружает production Google/grammY, MIME decoder, parser и classifier,
20 раз обрабатывает synthetic HTML размером ровно 1 MiB, затем много текстовых labels.
Нет startup, OAuth client, Telegram polling, scheduler, Gmail API или secrets.
Это проверка части runtime, **не измерение настоящего бот-процесса с сетью**, не worst-case
для всех возможных MIME/DOM и не доказательство отсутствия влияния на FSP под нагрузкой.
Числа и ограничения подтверждаются локальной таблицей результатов ниже.

При сумме существующих RAM caps FSP 1248 MiB и нового cap 384 MiB остаётся лишь
167 MiB до физической RAM хоста. Caps не означают фактическое потребление, но при
совпадении пиков безопасный запас ОС не гарантирован. Поэтому разрешается только
короткое наблюдаемое испытание; для постоянной работы предпочтителен отдельный VPS.

## 2. Два отдельных варианта

- `deploy/compose.firstvds-test.yaml`: **standalone** synthetic Compose, project
  `kwork-firstvds-test`, `network_mode: none`, restart no, без env_file/build/ports,
  без Docker socket, без FSP networks/volumes. Сервисы smoke и profile. Не объединять
  с базовым Compose и не применять production CMD. Profile монтирует только public
  probe read-only; smoke монтирует только свежий отдельный synthetic state directory.
- `deploy/compose.firstvds.yaml`: будущий **override** базового Compose, project
  `kwork-firstvds`, контейнер `kwork-firstvds-bot`, dedicated UID/GID 21001:21001,
  CPU/RAM ограничения выше, restart no, umask 077. Унаследованы read-only root,
  dropped caps, no-new-privileges, init и deployment state gate. Своя default bridge
  сеть с исходящим доступом; external FSP networks/volumes отсутствуют. Этот вариант
  удаляет inherited build через !reset и использует pull_policy never: даже при
  пропущенном CLI --no-build сборка на VPS не начнётся.
  запускает настоящий bot только после отдельного разрешения. Сейчас проверена лишь
  его объединённая конфигурация, сам bot не запускался.

Identity 21001 выбрана вместо fspdeploy/UID 1000. Перед серверным созданием проверить,
что UID и GID свободны; занятый ID означает STOP и отдельный выбор нового ID с повтором
Compose/probe/permissions проверок. Не chown-ить существующие каталоги под новый UID.
Directory state 0700, files 0600, owner 21001:21001. Скрипт smoke требует marker до
открытия DB; seed отказывается от любого непустого каталога. Настоящую state сюда
не помещать. Мониторинг M5 после рестарта OFF; synthetic helper вообще не открывает
ресурсы monitor controller. Ни env-переменной, ни command активации не добавлено.

## 3. Что владелец должен разрешить отдельно

Согласовать с совладельцем FSP окно не более 2 минут работы smoke плюс до 90 секунд
на мягкую остановку и один короткий resource probe, подтвердить конкретный хост, отдельные каталоги/run ID и создание
dedicated identity. Разрешить доставку и загрузку image, создание **только** synthetic
Compose контейнеров, наблюдение и узкую уборку. Это не разрешение переносить реальные
данные/secrets или запускать Telegram. CPU/RAM observations read-only, тестовые
контейнеры и каталоги — серверные изменения и сейчас не выполнялись.

Провести fresh preflight непосредственно перед тестом: amd64, Engine/Compose доступны,
MemAvailable >=1000 MiB, filesystem свободен >=5 GiB, RAM/swap pressure отсутствует,
контейнеры FSP не перезапускаются и их health соответствует baseline. Если условия
не соблюдены, тест не начинать. Не выполнять build/npm на VPS.

## 4. Передача готового образа

Опубликованный **исторический** базовый release: `ed41279a85c1fe0d78a3cbd85b20a9856e8b8c15`.
Прежний образ собран из `git archive` этого SHA, без пользовательских незакоммиченных
правок. Следующий тест использует APPROVED_FINAL_RELEASE_SHA после отдельной публикации;
сам SHA не придумывать. Снова build из git archive и полный проверенный delivery manifest.
Передавайте готовый image через `docker save` → согласованный SCP/SFTP → `docker load`.
Образ linux/amd64. Public probe и standalone YAML передавайте отдельными файлами;
это новая extension, отсутствующая в базовом SHA, поэтому сверять их SHA-256 тоже.
Перед использованием новой версии extension повторить её проверки/одобрение.

На Windows подготовить **новый** каталог вне checkout, не перезаписывать существующий:

```powershell
$kworkPackage = Join-Path $env:LOCALAPPDATA ('KworkSyntheticPackages/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $kworkPackage -ErrorAction Stop | Out-Null
docker save -o (Join-Path $kworkPackage 'image.tar') kwork-project-monitor:APPROVED_FINAL_RELEASE_SHA
if ($LASTEXITCODE -ne 0) { throw 'Image export failed' }
Copy-Item deploy/compose.firstvds-test.yaml,deploy/shared-host-probe.mjs -Destination $kworkPackage -ErrorAction Stop
$kworkNames = @('image.tar','compose.firstvds-test.yaml','shared-host-probe.mjs')
$kworkSums = foreach ($kworkName in $kworkNames) {
  $kworkHash = (Get-FileHash -LiteralPath (Join-Path $kworkPackage $kworkName)).Hash.ToLowerInvariant()
  "$kworkHash  $kworkName"
}
$kworkSums | Set-Content (Join-Path $kworkPackage 'SHA256SUMS') -Encoding ascii
```

После одобрения доставить эти четыре файла в новый private inbox владельца через
доверенный SSH transport. Не отключать host-key checking и не читать приватный ключ.
На сервере сверить `sha256sum --check SHA256SUMS` **до** docker load и установки файлов.
Image label/revision и локальный image ID сверять по таблице результатов, не по одному tag.

## 5. Порядок серверного synthetic теста — пока не выполнять

Команды — для согласованного Ubuntu-хоста, с `set -eu`; при любой ошибке STOP.
`APPROVED_RUN_ID`, `APPROVED_PRIVATE_INBOX` и FSP Compose project заменяет оператор
согласованными значениями. Run ID только латинские буквы/цифры/дефис; новые пути
под указанными test roots. В командах нет настоящих credentials или настоящей SQLite.

```sh
set -eu
umask 077
RUN_ID=APPROVED_RUN_ID
case "$RUN_ID" in ''|*[!a-zA-Z0-9-]*) exit 1;; esac
FSP_PROJECT=APPROVED_EXISTING_FSP_PROJECT
INBOX=APPROVED_PRIVATE_INBOX
RELEASE=APPROVED_FINAL_RELEASE_SHA
test "${#RELEASE}" -eq 40
case "$RELEASE" in *[!a-f0-9]*) exit 1;; esac
IMAGE=kwork-project-monitor:$RELEASE
CODE=/opt/kwork-firstvds-test/run-$RUN_ID
DATA=/var/lib/kwork-firstvds-test/run-$RUN_ID
PROJECT=kwork-firstvds-test-$RUN_ID
case "$PROJECT" in kwork-firstvds-test-*) ;; *) exit 1;; esac
AUDIT_DIR=$(mktemp -d)
sudo test ! -e "$CODE" && sudo test ! -L "$CODE"
sudo test ! -e "$DATA" && sudo test ! -L "$DATA"
test -z "$(getent passwd 21001 || true)"
test -z "$(getent group 21001 || true)"
test -z "$(getent passwd kworkmonitor || true)"
test -z "$(getent group kworkmonitor || true)"
test -z "$(sudo docker ps -aq --filter label=com.docker.compose.project="$PROJECT")"
sudo docker info --format '{{.OSType}}/{{.Architecture}}'
free -m
df -h /var/lib/docker
vmstat 1 10
cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io
sudo docker ps --filter label=com.docker.compose.project="$FSP_PROJECT" --format '{{.Names}} {{.Status}}'
```

Проверить вручную архитектуру, количество **четырёх** FSP контейнеров и условия preflight.
Не применять числовые пороги из первой строки vmstat: это среднее с момента boot.
Нет прав Docker/sudo — остановиться, не добавлять пользователя в docker group.

После проверки создать identity и **новые** каталоги. Если identity уже была создана
предыдущим одобренным испытанием, не повторять эти команды: подтвердить её назначение
и ownership отдельно, затем использовать новый run ID. Не считать любой UID 21001 своим.

```sh
sudo groupadd --gid 21001 kworkmonitor
sudo useradd --uid 21001 --gid 21001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin kworkmonitor
sudo install -d -m 0700 "$CODE" "$DATA"
sudo install -d -m 0700 -o 21001 -g 21001 "$DATA/state"
(cd "$INBOX" && sha256sum --check SHA256SUMS)
sudo install -m 0644 "$INBOX/compose.firstvds-test.yaml" "$CODE/compose.firstvds-test.yaml"
sudo install -m 0644 "$INBOX/shared-host-probe.mjs" "$CODE/shared-host-probe.mjs"
sudo docker load -i "$INBOX/image.tar"
sudo docker image inspect "$IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
printf 'KWORK_RELEASE=%s\nKWORK_TEST_STATE_DIR=%s/state\nKWORK_TEST_PROBE=%s/shared-host-probe.mjs\n' "$RELEASE" "$DATA" "$CODE" | sudo tee "$CODE/test.env" >/dev/null
sudo chmod 0600 "$CODE/test.env"
dc() { sudo docker compose --env-file "$CODE/test.env" -p "$PROJECT" -f "$CODE/compose.firstvds-test.yaml" "$@"; }
dc --profile profile config --quiet
```

CODE parent 0700 ограничивает host readers; bind файла probe работает через Docker
daemon/root, в контейнере public file 0644. Для настоящих secrets это правило не подходит.
Записать до теста private baseline только безопасных metadata, без Config.Env/log contents:

```sh
FSP_IDS=$(sudo docker ps -aq --filter label=com.docker.compose.project="$FSP_PROJECT")
test "$(printf '%s\n' "$FSP_IDS" | wc -l)" -eq 4
fsp_snapshot() {
  sudo docker inspect $FSP_IDS --format '{{.Id}} {{.Image}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}} {{.State.OOMKilled}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' || return 1
  sudo docker inspect $FSP_IDS --format '{{.Id}} {{json .NetworkSettings.Networks}} {{json .Mounts}} {{json .HostConfig.PortBindings}}' || return 1
}
fsp_snapshot > "$AUDIT_DIR/fsp-before.txt"
sudo docker network ls --format '{{.ID}} {{.Name}}' > "$AUDIT_DIR/networks-before.txt"
sudo docker volume ls --format '{{.Name}}' > "$AUDIT_DIR/volumes-before.txt"
```

Второе SSH-окно только для наблюдения: `vmstat 1`, периодический `free -m`,
`cat /proc/pressure/{cpu,memory,io}` и `sudo docker stats --no-stream`. Последняя команда
показывает ресурсы, без credentials. Наблюдение должно уже работать до запуска probe.

```sh
dc --profile profile run --rm --no-deps profile
# Только shared_probe_ok, без OOM и без нарушения порогов.
dc run --rm --no-deps smoke sh -c 'umask 077; exec node deploy/offline-smoke.mjs --state-dir /app/.local-state --seed'
SMOKE_DEADLINE=$(( $(date +%s) + 120 ))
# Наблюдатель во втором окне получает этот абсолютный deadline; restart его не меняет.
printf 'Stop smoke by Unix time %s\n' "$SMOKE_DEADLINE"
dc up -d --no-build --pull never smoke
dc logs --tail 20 smoke
# Дождаться offline_smoke_signal_ready. Счётчик ожидания helper — максимум 120 секунд.
dc ps
SMOKE_ID=$(dc ps -q smoke)
test -n "$SMOKE_ID"
sudo docker inspect "$SMOKE_ID" --format 'user={{.Config.User}} cpu={{.HostConfig.NanoCpus}} ram={{.HostConfig.Memory}} total={{.HostConfig.MemorySwap}} net={{.HostConfig.NetworkMode}} readonly={{.HostConfig.ReadonlyRootfs}}'
sudo docker inspect "$SMOKE_ID" --format '{{json .Mounts}} {{json .HostConfig.PortBindings}}'
sudo docker exec "$SMOKE_ID" sh -ec 'id; stat -c "%u:%g %a %n" /app/.local-state /app/.local-state/monitor.sqlite /app/.local-state/monitor.sqlite.guard.json; cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max'
if test "$(date +%s)" -ge "$SMOKE_DEADLINE"; then dc stop smoke; exit 1; fi
dc restart smoke
dc logs --tail 20 smoke
# Новая readiness и offline_smoke_ok при прежней остановке; наблюдение продолжается.
dc stop smoke
sudo docker inspect "$SMOKE_ID" --format 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
dc run --rm --no-deps smoke node dist/ops/stateCheckRun.js /app/.local-state
fsp_snapshot > "$AUDIT_DIR/fsp-after.txt"
diff -u "$AUDIT_DIR/fsp-before.txt" "$AUDIT_DIR/fsp-after.txt"
```

Ожидаются CPU 250000000 NanoCpus, RAM/total 402653184, cgroup swap.max 0,
cpu.max `25000 100000`, uid/gid 21001, directory 700, SQLite/guard 600, bind source
строго `$DATA/state`, нет socket/ports/FSP mounts. После SIGTERM exit 0, OOM false,
deployment_state_ok. Если readiness нет, не делать restart вслепую; остановить только smoke.
Не выдавать Docker exec/env, inspect Config или полные логи FSP за безопасную диагностику.
Общий wall-clock deadline активного smoke — 120 секунд от первого `up smoke` до отправки
SIGTERM через `stop`. Наблюдатель останавливает smoke при его достижении, даже между
ручными командами; restart не продлевает окно. На drain допускается ещё до 90 секунд,
то есть максимум 210 секунд до выхода. Начало и конец фиксировать в private evidence.

## 6. Пороги немедленной остановки

Пороговые значения — консервативные правила этого теста, не утверждение о гарантированной
ёмкости хоста. При любом срабатывании остановить **только** project `$PROJECT`; если
profile ещё работает, сначала получить его точный ID по project label и stop его.

- MemAvailable ниже **650 MiB в двух последовательных отсчётах по 5 секунд**, либо
  ниже **500 MiB один раз**; cgroup memory.current теста >=90% cap (346 MiB).
- Host CPU busy >=80% в течение 30 секунд, либо заметно выросшая задержка FSP по
  наблюдению владельца. Краткий spike сам по себе не доказывает конфликт.
- Новые постоянные `si`/`so` в vmstat (два отсчёта), memory PSI `full avg10` >0.5
  два раза, рост memory.events oom/oom_kill или container OOMKilled.
- Любой новый restart, exit или ухудшение health одного FSP контейнера; потеря SSH
  responsiveness, устойчивый рост disk I/O wait или нехватка диска — STOP.
- Smoke не сообщил readiness/ok, вышел с ошибкой, достиг 120-секундного timeout,
  или не завершился мягко. Не чинить DB/guard ради продолжения теста.

```sh
TEST_IDS=$(sudo docker ps -q --filter label=com.docker.compose.project="$PROJECT")
if test -n "$TEST_IDS"; then sudo docker stop --time 90 $TEST_IDS; fi
dc ps -a
```

Если SIGTERM не сработал, Docker после deadline может применить SIGKILL; это провал
испытания. Никаких рестартов FSP, Docker daemon или VPS. Не увеличивать RAM для обхода
порога и не повторять серверный тест автоматически. Сохранить fixed-status evidence.

## 7. Уборка исключительно теста

После итогового snapshot, при остановленных test containers:

```sh
case "$PROJECT" in kwork-firstvds-test-*) ;; *) exit 1;; esac
for TEST_ID in $(sudo docker ps -aq --filter label=com.docker.compose.project="$PROJECT"); do
  TEST_SERVICE=$(sudo docker inspect "$TEST_ID" --format '{{index .Config.Labels "com.docker.compose.service"}}')
  case "$TEST_SERVICE" in smoke|profile) ;; *) exit 1;; esac
done
dc down --timeout 90
test -z "$(sudo docker ps -aq --filter label=com.docker.compose.project="$PROJECT")"
sudo docker network ls --format '{{.ID}} {{.Name}}' > "$AUDIT_DIR/networks-after.txt"
sudo docker volume ls --format '{{.Name}}' > "$AUDIT_DIR/volumes-after.txt"
diff -u "$AUDIT_DIR/networks-before.txt" "$AUDIT_DIR/networks-after.txt"
diff -u "$AUDIT_DIR/volumes-before.txt" "$AUDIT_DIR/volumes-after.txt"
fsp_snapshot > "$AUDIT_DIR/fsp-cleanup.txt"
diff -u "$AUDIT_DIR/fsp-before.txt" "$AUDIT_DIR/fsp-cleanup.txt"
```

Standalone не создаёт networks/named volumes. Нельзя `docker system prune`, volume prune,
stop всех контейнеров, `down` FSP или удаление по общему имени. Образ можно удалить только
по своему **точному tag** после подтверждения, что другие контейнеры его не используют;
не удалять shared base image и не применять force. Можно оставить release image для
следующего одобренного этапа. Хостовые synthetic data не удаляются при `down`.

После сохранения private evidence отдельно разрешённая уборка synthetic каталога:
оператор проверяет `realpath "$DATA"` и `realpath "$CODE"`, отсутствие symlinks и что
пути ровно `/var/lib/kwork-firstvds-test/run-$RUN_ID` и `/opt/kwork-firstvds-test/run-$RUN_ID`.
Проверяет marker `$DATA/state/.m6-synthetic-state` = `M6 offline synthetic fixture only`.
Только затем `sudo rm -r -- "$DATA" "$CODE"`. Это никогда не процедура удаления настоящей
state. Dedicated account не удалять вслепую: убедиться, что у него нет других назначений.
Image inbox/archive удаляется лишь по отдельно проверенным собственным путям.

## 8. Будущий настоящий тест и перенос на другой VPS

Пока не выполнять. Владелец и совладелец должны принять, что root и пользователи с
sudo/docker полномочиями технически могут получить Gmail refresh token, Telegram token,
окружение и ledger. UID, directory 0700 и secret file 0600 защищают от непривилегированных
пользователей, **не от администраторов общего хоста**. Если это неприемлемо — отдельный VPS.
Не монтировать home/SSH/.env checkout; root-only `/etc/kwork-firstvds/bot.env` вводит
владелец приватно, без shell history/чата. Проверка Compose только
`config --no-env-resolution --quiet`; не выводить merged secrets или Config.Env.

Для real shared test потребуется отдельное одобрение override + nonsecret firstvds.env,
переноса настоящего состояния и ровно одного poller OFF. Использовать только
`-f compose.yaml -f deploy/compose.firstvds.yaml`, отдельный project и директорию real
state `/var/lib/kwork-firstvds/state`; не использовать synthetic state/marker и не
выполнять seed. Не запускать scheduler, /projects, baseline commands или acceptance
для проверки deployment. Сохранить deployment gate и private owner/account binding.
Настоящий future startup только с `up -d --no-build --pull never bot` после загрузки
одобренного image: наличие build section в унаследованном Compose не разрешает VPS build.

Перенос с Windows → FirstVDS и позднее FirstVDS → отдельный VPS одинаков:

1. Мягко остановить **все** старые pollers/one-shot процессы, отключить их auto start,
   подтвердить отсутствие других экземпляров и дождаться закрытия store. Не копировать
   работающую DB с независимым guard. Нет online-backup shortcut для этой пары.
2. Проверить `stateCheckRun.js` без secrets/сети после остановки. Busy/corrupt/schema/
   guard/baseline mismatch означает STOP без создания baseline и ручного удаления session.
3. Сохранить private CURRENT guard как high-water отдельно от backup. Скопировать полный
   directory: ledger + guard + WAL/SHM, если существуют; Gmail baseline уже в ledger,
   отдельного захвата baseline не нужно. Сверить private checksum manifest до открытия.
4. Передать согласованный набор в новый private staging destination через доверенный
   SSH; не смешивать старые/new WAL/guard, не перезаписывать уже существующую state.
5. Выставить UID destination (21001 shared или 1000 base отдельного VPS), dir 0700,
   files 0600. Выполнить network-none checker против staging и retained CURRENT guard.
   Consistent old DB+old guard сами по себе не доказывают сохранность новых tombstones;
   full directory rollback локально не обнаружим. Не разрешать older data restore.
6. Подключить существующий проверенный directory к `/app/.local-state`, запустить
   только одну копию OFF после явного разрешения poller; старый host остаётся stopped.
   Проверить mount/owner и owner-private status. Включение мониторинга отдельно.
7. Image update/rollback сохраняет **текущую** state. При ошибке остановить новую копию,
   проверить актуальную state и лишь затем одобрить запуск старого image/host с тем же
   актуальным набором; не запускать оставшуюся на старом хосте устаревшую snapshot.

Shared destination checker **явно** использует UID21001, не image default1000.
После остановки всех writers, на согласованной staging копии и с доступным этому UID
retained CURRENT guard (отдельный private bind) выполнить:

```sh
sudo docker run --rm --network none --read-only --user 21001:21001 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount type=bind,source=/var/lib/kwork-firstvds/incoming,target=/app/.local-state \
  --mount type=bind,source=/var/lib/kwork-firstvds/current-guard,target=/run/current-guard,readonly \
  kwork-project-monitor:APPROVED_RELEASE_SHA \
  node dist/ops/stateCheckRun.js /app/.local-state /run/current-guard/monitor.sqlite.guard.json
```

`incoming` и `current-guard` — предварительно согласованные новые private каталоги
21001:21001/0700 с files0600; guard сохраняется независимо от старого backup. Эти пути
не создавать и не переносить сейчас. Baseline/checker не запускать как root ради обхода
EACCES и не расширять права. Для отдельного VPS default1000 базового сценария сохраняется.

Snapshot evidence сохраняется в новом `$AUDIT_DIR` с umask077, без pipeline: ошибка
каждого Docker producer передаётся вызывающей команде. Не полагаться на `set -e` для
`producer | tee`. Сохранять evidence приватно; его удаление отдельно от Docker cleanup.

Самостоятельное ENV управление: `docs/m6-env-management.md`. Оно требует нового
одобренного image с configCheckRun; published ed41279 этого helper ещё не содержит.

Подробные backup/restore и fail-closed codes: `docs/milestone-6.md`. Реальный перенос,
credential protection runtime, Telegram/Gmail и VPS reboot не проверены этим тестом.

## 9. Локальные результаты подготовки

Проверено 2026-10-13 на Docker Engine 29.4.3 / Linux amd64. SSH-аудит хранится отдельно
и не публикуется вместе с M6. Extension остаётся uncommitted до отдельного запроса.

Release image ID на этом Engine:
`sha256:b52955b54b32cf4bc2dfac6f323eeb9fd9f3b409df8fa78c9e53de86a0de2b97`.
Сборка явно задавала `--label org.opencontainers.image.revision=ed41279a85c1fe0d78a3cbd85b20a9856e8b8c15`;
label прочитан независимо через image inspect. При другой Docker image storage backend
ID может отображаться иначе: тогда STOP до сверки platform manifest/config digest и
archive checksum, а не обход проверки по одному tag. Не подставлять неизвестный новый ID.
Подготовленный image.tar (109762048 bytes) имеет SHA-256
`5379ab25b0d9a0a2a9495aaca73d4d4755cb427f59527d8543979bbbe877d81e`.
Он сохранён вместе с public YAML, probe и SHA256SUMS в новом ignored delivery-каталоге;
на VPS ничего не передавалось. При новом docker save checksum может измениться;
согласовать новый manifest отдельно и сверять фактически переданный archive.

| Проверка | Фактический результат |
| --- | --- |
| Publication | Ровно 14 базовых M6 файлов; normal push; GitHub main подтвердил release SHA |
| Source | Image из нового git archive опубликованного SHA; предыдущие пять Gmail/test правок исключены |
| typecheck | PASS текущего дерева |
| npm test | PASS вне Windows sandbox, 599 / 35; первый sandbox запуск имел temp-cache/SQLite access failures |
| lint / build | PASS текущего дерева; production Docker build PASS опубликованного SHA |
| npm audit | 0 vulnerabilities |
| Compose standalone и merged override | PASS с public templates; future real bot не запускался |
| Probe при 512 MiB | RSS peak 216776 KiB (211.7 MiB), cgroup peak 225120256 bytes (214.7 MiB), CPU 0.25, swap 0 |
| Probe при выбранных 384 MiB | PASS; RSS peak 228128 KiB (222.8 MiB), cgroup peak 189362176 bytes (180.6 MiB), swap.max 0, cpu.max 25000 100000 |
| Smoke idle | 14.02 MiB по docker stats; это mock lifecycle, не настоящий bot runtime |
| Actual limits/security | RAM/total 402653184, CPU NanoCpus 250000000, PID 64, read-only, cap ALL dropped, no-new-privileges, network none, no ports/socket |
| Permissions | UID/GID 21001; dir 0700, DB/guard 0600; UID21002 EACCES, rootfs write EROFS |
| Persistent bind | Seed/restart/recreate PASS; baseline/epoch/tombstones/messages retained, guard checker ok |
| Nonempty seed | Refused, unchanged fixture; no reset |
| Missing marker / bind source | Refused; missing marker did not create DB/guard, missing bind was not auto-created |
| Image content | 10 layers; 3968 app/dependency files inspected; forbidden private paths 0, unresolved credential-like patterns 0. Three matches are public googleapis PEM-header documentation, not keys |
| SIGTERM | restart/stop exit 0, OOM false; synthetic lifecycle only |
| Unrelated Docker projects | 15 existing containers remained exited; IDs/names and all network/volume inventory unchanged |
| Cleanup | Own synthetic Compose container and labeled backing volume removed; release image/archive retained |
| Preservation | Hashes of previous five edits, HANDOFF, private audit and real state files unchanged |
| VPS writes/live APIs/real migration | НЕ ПРОВОДИЛИСЬ |

RSS peak и cgroup memory.peak — разные kernel metrics: RSS включает resident pages процесса,
а cgroup учитывает charging страниц группе, включая shared/cache. Не вычитать меньший
из них из лимита как гарантию; для выбора 384 MiB учтён больший измеренный RSS ~223 MiB.
Пиковые real SDK responses, hostile DOM и FSP нагрузка остаются непроверенными.

Источники параметров: Context7 `/docker/docs`, [Compose services](https://docs.docker.com/reference/compose-file/services/),
[Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).
`memswap_limit` равный `mem_limit` запрещает swap; CPU quota не гарантирует свободное ядро.
