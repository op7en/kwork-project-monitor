# Milestone 6 — Docker на отдельном Ubuntu 24.04 VPS

Базовая подготовка опубликована в ed41279. Заключительные исправления и ENV management
готовятся отдельно, без публикации: [final review](m6-final-adversarial-review.md),
[ENV](m6-env-management.md), [shared-host test](m6-shared-host-test.md).
Исторические результаты ниже относятся к первоначальной подготовке; для нового
controlled test нужен одобренный final release SHA. Сценарий отдельного VPS сохранён.

Это инструкция подготовки и будущих разрешённых действий. В этой сессии сервер не
создавался, SSH не использовался, реальные секреты не читались, состояние не переносилось,
бот и Gmail не запускались. Команды ниже нельзя считать уже выполненным deployment.

## 1. Решение и границы

Один Docker Compose service с Telegram long polling. Входящих HTTP-портов, домена,
reverse proxy и HTTPS-сервера нет. Контейнеру нужен исходящий HTTPS к Telegram и Google,
DNS и корректное время. На хосте открываем только согласованный SSH-порт.

Используется официальный `node:24-bookworm-slim`: поддерживаемая линия Node 24,
Debian/glibc и встроенный `node:sqlite`. Рабочая директория `/app`; каталог хоста
`/var/lib/kwork-project-monitor` смонтирован в `/app/.local-state`. Образ не содержит
секретов или состояния. Multi-stage сборка устанавливает зависимости из lockfile через
`npm ci --ignore-scripts`; в runtime нет devDependencies. Скрипты установки не нужны
нынешним зависимостям; при добавлении native addon это решение пересматривается.

Node 24.1.0 — прежний локально проверенный runtime M5/M6. Продолжение M6 проверено
в Docker Linux/amd64 на Node **24.21.0**, включая 599 offline-тестов. Default base теперь
зафиксирован: `node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`.
Этот digest обновляют явно вместе с offline-проверками; автоматического получения
patch-обновлений нет. Для выпуска также фиксируем одобренный Git SHA и ID готового образа.
Проверка на другой архитектуре VPS остаётся отдельным шагом.

Контейнер работает как UID/GID 1000, с read-only root filesystem, отдельным `/tmp`,
без Linux capabilities и с no-new-privileges. Docker daemon/root на VPS имеют доступ
к окружению контейнера: environment variables не являются защитой от администратора
хоста. Не давайте посторонним Docker socket или членство в группе docker.

`restart: unless-stopped` возобновляет бот после сбоя/перезагрузки; вручную остановленный
контейнер остаётся остановленным. **Мониторинг после любого рестарта OFF.** Автоматически
получить и непрерывный мониторинг после reboot, и обязательное новое согласие владельца
нельзя. Для этого этапа новое согласие важнее доступности scheduler.

Compose использует `init: true`, прямой Node CMD и SIGTERM, 90 секунд на остановку.
M5 lifecycle ждёт текущую сеть и закрывает store после прохода; новые операции запрещены.
90 секунд больше существующих отдельных таймаутов Gmail 10s / Telegram 45s, но не
гарантируют завершение при зависшем SDK/ОС. SIGKILL, OOM, потеря питания — аварии;
после них проверка session/guard может потребовать отдельного обслуживания.

`container_name` фиксирован, replicas не используются. Это мешает запустить вторую
Compose-копию на том же Docker daemon, но не предотвращает poller на другом хосте.
Межхостовой singleton обеспечивается процедурой остановки исходной копии.

## 2. Фактическое состояние M5 и deployment gate

Проверены `src/monitor/store.ts`, `ledgerGuard.ts`, `runtime.ts`, `controller.ts`,
`src/index.ts`, `src/bot/lifecycle.ts`, README и документы M5. На начало работы локальный
HEAD и read-only GitHub main совпадают: `e3fdf88740afcbc9fdd48821333f280a7cd5999c`.
Есть пять прежних локальных изменений Gmail/tests и HANDOFF-файл; M6 их не перезаписывает.
HEAD M5 **ещё не содержит M6**. До клонирования для deployment нужен отдельно одобренный
и опубликованный commit M6; здесь commit/push не разрешены и не выполнены.

M5 хранит schema version 1; meta содержит binding, epoch, revision, history и floor.
Таблица projects сохраняет tombstones для sent, delivery_unknown и filtered;
reserved после crash не разрешает повторную отправку. Session содержит host/PID;
чужой хост или неопределённый живой PID блокирует store. WAL + synchronous=FULL.
Guard `monitor.sqlite.guard.json` независимо содержит epoch/revision и заменяется
после SQL commit. Реальные значения этих данных не нужны в логах/отчётах.

Deployment entry point `dist/ops/start.js` проверяет конфигурацию и **существующее**
состояние до импорта обычного `dist/index.js`. Требуются непустой ledger, guard,
quick_check=ok, schema 1, baseline, точное равенство epoch/revision, пустая session
и binding к тем же Gmail-аккаунту/Telegram owner. Не происходит initialization,
baseline capture, захвата session, её удаления или Gmail-запроса.

Это намеренно строже обычного M5 recovery: DB-ahead-guard и orphan session требуют
разбора аварии перед контейнерным запуском. Никакая автоматическая починка не добавлена.
Обычные `npm run dev` / `npm start` остаются прежними; контейнерный gate защищает
именно перенос существующей установки. При намеренном обходе CMD его защита исчезает.

Утилита `dist/ops/stateCheckRun.js [каталог] [текущий-сохранённый-guard]` открывает
SQLite READ ONLY, печатает только `deployment_state_ok` либо фиксированный код ошибки.
Она не читает .env, не печатает ID/курсор/email и не вызывает MonitorStore.
SQLite может создать служебные WAL/SHM на writable mount; ledger и guard не меняются.
Проверка не блокирует будущего writer: все копирования выполняются после доказанной
остановки **всех** копий, а не только после успешной проверки.

## 3. Что требуется подтвердить перед сервером

1. Отдельный VPS Ubuntu 24.04 LTS, его адрес/SSH-ключ/пользователь; это не FSP Platform.
2. Одобренный commit M6 и разрешение его опубликовать либо другой явно согласованный
   способ доставки кода. Выбранные архитектура VPS, размер диска и расходы.
3. Разрешение на SSH, установку Docker, создание каталогов и настройку SSH/firewall.
4. Разрешение остановить текущую копию, сделать согласованный backup и перенести
   ledger/guard/WAL/SHM. Прежняя копия останется остановленной.
5. Владелец сам размещает действующие secrets через защищённый канал; не в чат.
6. Разрешение запустить **один** Telegram poller с мониторингом OFF и проверить
   owner-private `/ping` и `/monitor status`. Это уже реальный Telegram, не offline.
7. M5 acceptance и включение scheduler — отдельные будущие разрешения. Здесь их нет.

Отсутствие нового Gmail-события не мешает подготовке контейнера. До приёмки M5 нельзя
называть реальные автоматические уведомления проверенными.

## 4. Подготовка чистого VPS (только после разрешения)

Минимальный практический ориентир: 1 vCPU, 2 GiB RAM, локальный SSD с запасом для
образов и backups; это оценка, не результат нагрузочного теста. Runtime ограничен
512 MiB / 128 процессов; OOM в реальной работе требует анализа, а не очистки ledger.
Сборка использует больше памяти и не ограничивается runtime mem_limit.

Откройте SSH-сессию согласованным ключом. До изменения firewall проверьте, что новая
SSH-сессия открывается. Не отключайте прежний способ входа до этой проверки.

```sh
sudo apt update
sudo apt upgrade
sudo apt install -y ca-certificates curl git ufw
sudo timedatectl set-ntp true
timedatectl status
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

`OpenSSH` подходит только для стандартного порта 22. При другом SSH-порте разрешите
именно его перед включением UFW. У Docker есть особенности обхода UFW для опубликованных
портов; наш Compose не публикует порты. Проверьте также firewall панели провайдера.

Установите Docker из официального apt repository для Ubuntu. На действительно чистом
VPS конфликтующие Docker/containerd пакеты отсутствуют; на непустом сервере сначала
инвентаризация по официальной инструкции, без слепого удаления пакетов.

```sh
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Требуется Compose **>=2.30.0** для `env_file.format: raw`; новый major тоже допустим.
Node.js/npm на VPS-хост устанавливать не нужно — runtime находится внутри образа.
Не запускайте remote convenience script через pipe в shell.

## 5. Код, release и конфигурация

Получите приватный репозиторий через свой SSH-ключ GitHub с правом чтения. Не вставляйте
PAT в clone URL/командную строку. Проверьте fingerprint GitHub host key по официальной
странице; не отключайте StrictHostKeyChecking.

```sh
sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" /opt/kwork-project-monitor
git clone git@github.com:op7en/kwork-project-monitor.git /opt/kwork-project-monitor
cd /opt/kwork-project-monitor
git status --short
git fetch origin
git checkout --detach APPROVED_M6_COMMIT_SHA
git rev-parse HEAD
```

`APPROVED_M6_COMMIT_SHA` замените одобренным SHA **с файлами M6**. Если каталог уже
существует/не пуст или checkout dirty — остановитесь, не выполняйте reset/clean.
Не используйте слепой `git pull` для production updates.

Создайте отдельные каталоги. UID 1000 в контейнере должен владеть state, независимо
от имени пользователя VPS. Secrets хранит root; Compose запускаем через sudo.

```sh
sudo install -d -m 0700 /etc/kwork-project-monitor
sudo install -d -m 0700 -o 1000 -g 1000 /var/lib/kwork-project-monitor
sudo install -d -m 0700 /var/backups/kwork-project-monitor
sudo install -m 0600 deploy/bot.env.example /etc/kwork-project-monitor/bot.env
sudo install -m 0600 deploy/compose.env.example /etc/kwork-project-monitor/compose.env
sudo nano /etc/kwork-project-monitor/bot.env
sudo nano /etc/kwork-project-monitor/compose.env
```

Эти команды install предназначены для **первого** создания. Если конфигурационные
файлы уже есть — не перезаписывайте их шаблоном. Владелец вводит secrets в редакторе,
не показывает экран/содержимое агенту и не передаёт их через shell arguments/history.
Формат bot.env — `KEY=value` без export и без кавычек. Compose raw не интерполирует
`$` и не удаляет кавычки: кавычки стали бы частью значения. Не source-ите этот файл.

Обязательные имена для deployment:

| Приложение | Назначение |
| --- | --- |
| TELEGRAM_BOT_TOKEN | Уже существующий BotFather token |
| TELEGRAM_OWNER_ID | Тот же private owner, к которому привязан ledger |
| GMAIL_CLIENT_ID | Существующий OAuth client |
| GMAIL_CLIENT_SECRET | Существующий OAuth secret |
| GMAIL_REFRESH_TOKEN | Существующий refresh token |
| GMAIL_EXPECTED_ACCOUNT_EMAIL | Тот же Gmail account; READ ONLY gates сохраняются |
| MONITOR_INTERVAL_MINUTES | Необязательный интервал, 5..1440; default 360 |
| MONITOR_MAX_MESSAGES | Необязательный лимит 1..100; default 100 |
| MONITOR_MAX_SENDS | Необязательный лимит 1..10; default 10 |

Compose settings: `KWORK_RELEASE`, `KWORK_NODE_IMAGE`, `KWORK_SECRETS_FILE`,
`KWORK_STATE_DIR`. Пути secrets/state — абсолютные, значения не переопределять
при обычном обновлении. `NODE_ENV=production` задан образом. Smoke/acceptance IDs
в production bot.env не нужны. Env-переменной включения мониторинга нет.

Всегда явно указывайте **nonsecret** compose.env как `--env-file`, чтобы Compose не
подхватывал локальный .env checkout. Не выполняйте обычный `docker compose config`,
`config --environment`, Docker inspect окружения, printenv или env: они могут показать
secrets. Для схемы без раскрытия значений:

```sh
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env config --no-env-resolution --quiet
```

## 6. Проверка образа до реального запуска

На согласованной Docker-среде (всё ещё без bot.env/state/API):

```sh
sudo docker pull node:24-bookworm-slim
sudo docker image inspect node:24-bookworm-slim --format '{{index .RepoDigests 0}}'
```

Запишите возвращённый `node@sha256:...` в `KWORK_NODE_IMAGE`. Это public digest, не
secret. Не придумывайте его и не используйте старый непроверенный digest из заметок.
После этого build:

```sh
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env build --pull bot
sudo docker image inspect kwork-project-monitor:APPROVED_M6_COMMIT_SHA --format '{{.Id}}'
```

В следующих командах замените APPROVED_M6_COMMIT_SHA тем же KWORK_RELEASE. Docker smoke
**не использует Compose**, чтобы не подключить реальный env_file/volume по ошибке.

```sh
sudo docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777 \
  kwork-project-monitor:APPROVED_M6_COMMIT_SHA node deploy/offline-smoke.mjs
```

Ожидается `offline_smoke_ok`: синтетическая SQLite, baseline, guard, tombstone и
повторное открытие, mock lifecycle, мониторинг OFF. Нет real config/startup/Gmail/Telegram.
Проверка настоящего сигнала контейнеру также использует только mock bot:

```sh
sudo docker run -d --name kwork-m6-signal-smoke --init --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777 \
  kwork-project-monitor:APPROVED_M6_COMMIT_SHA node deploy/offline-smoke.mjs --wait-for-signal
sudo docker logs kwork-m6-signal-smoke
```

Только увидев `offline_smoke_signal_ready` (в пределах 120s), выполните:

```sh
sudo docker stop --time 90 kwork-m6-signal-smoke
sudo docker logs kwork-m6-signal-smoke
sudo docker inspect kwork-m6-signal-smoke --format '{{.State.ExitCode}}'
sudo docker rm kwork-m6-signal-smoke
```

Ожидаются `offline_smoke_ok` и exit 0. Если timeout/exit не 0 — не запускать production.
Это signal/drain smoke mock lifecycle, не доказательство реального Telegram shutdown.
Если имя smoke уже занято, сначала выясните происхождение контейнера, не удаляйте чужой.

### Дополнительная offline-проверка persistent bind state

Не используйте production Compose или настоящее `.local-state` для smoke. Создайте
новый пустой synthetic-каталог на Linux-хосте, владелец 1000:1000, mode 0700.
В первой одноразовой network-none копии образа смонтируйте его в `/app/.local-state`
и переопределите CMD: `node deploy/offline-smoke.mjs --state-dir /app/.local-state --seed`.
Повторный seed непустого каталога должен завершиться фиксированным failure без сброса.

Дальнейший CMD: `node deploy/offline-smoke.mjs --state-dir /app/.local-state --wait-for-signal`.
Запуск требует marker `.m6-synthetic-state`, созданный seed; отсутствие marker
останавливает smoke до открытия SQLite. Smoke не читает окружение и не импортирует
настоящие startup/API clients; MonitorController остаётся OFF. В persistent режиме
файлы не удаляются при выходе. Без `--state-dir` прежний smoke использует только OS temp.

Запустите отдельный тестовый контейнер с network=none, init, read-only root, cap_drop
и этим bind. Дождитесь readiness, выполните Docker restart, снова readiness, затем
Docker stop. Ожидаются по одному `offline_smoke_ok` на каждую мягкую остановку и exit 0.
После остановки `stateCheckRun.js` на том же synthetic mount должен вернуть
`deployment_state_ok`; history/floor/epoch, sent tombstone и counts сохраняются.
Не превращайте этот helper в процедуру проверки настоящих данных.

В продолжении M6 Linux fixture находился в backing directory **нового собственного**
маркированного Docker volume и подключался именно через `type=bind`. Это позволило
проверить POSIX permissions без особенностей Windows/NTFS. Fixture: каталог 1000:1000
0700, SQLite 1000:1000 0644, guard 1000:1000 0600; UID 1001 получил EACCES благодаря
закрытому каталогу. Для переноса реальной базы инструкция ниже требует file mode 0600.
Настоящий каталог состояния и volumes других проектов не подключались.

## 7. Перенос существующего состояния: согласованный набор

**В этой сессии перенос не выполняется.** После отдельного разрешения:

1. На исходном Windows-хосте остановите production/smoke/acceptance процессы мягко
   Ctrl+C, дождитесь выхода. Не оставляйте локальный бот в background/watch mode.
   Убедитесь по PID и диспетчеру задач, что копий нет; не выводите командные строки,
   которые могли содержать credentials. Если бот работал через другой supervisor,
   отключите его автоматический запуск. Старую копию не запускать после экспорта.
2. Из корня checkout после build запустите `node dist/ops/stateCheckRun.js`.
   Здесь нет `--env-file`, реальное .env не читается. Ожидается `deployment_state_ok`.
   Missing baseline, busy/foreign session, corrupt/schema/guard mismatch — STOP.
   Не запускать baseline command и не удалять session/guard для обхода отказа.
3. Создайте **новый** private staging-каталог вне Git. Скопируйте в него весь
   `.local-state` после остановки: `monitor.sqlite`, `monitor.sqlite.guard.json`,
   `monitor.sqlite-wal`, `monitor.sqlite-shm`, если последние существуют. Не удаляйте
   WAL/SHM вручную и не копируйте только основной DB-файл. Проверку выполняйте на копии
   отдельно: `node dist/ops/stateCheckRun.js ABSOLUTE_STAGING_STATE_PATH`.
4. Для каждого файла запишите SHA-256 в приватный manifest и сверяйте при передаче.
   Не публикуйте state/manifest: идентификаторы внутри ledger приватны.
5. Через одобренный SCP/SFTP перенесите набор в **новый** private staging-каталог VPS,
   например `/var/lib/kwork-project-monitor-incoming`. Сверьте SHA-256 на обеих сторонах
   до открытия SQLite. Не переносите реальные data в checkout/image и не перезаписывайте
   уже существующий VPS ledger. Секреты передаются отдельно владельцем.
6. На VPS выставьте owner 1000:1000, каталог 0700, файлы 0600; проверьте staging
   утилитой из образа без сети и secrets (команда ниже). Только после успешной проверки
   согласованный набор размещается в `/var/lib/kwork-project-monitor`.

Пример подготовки копии на Windows **только после остановки и разрешения переноса**.
Команды выполняются из корня checkout; реальные ID/содержимое не выводятся:

```powershell
node dist/ops/stateCheckRun.js
if ($LASTEXITCODE -ne 0) { throw 'State check failed; stop transfer' }
$m6TransferDir = Join-Path $env:LOCALAPPDATA ('KworkMonitorTransfers/' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $m6TransferDir -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath .local-state -Destination $m6TransferDir -Recurse -ErrorAction Stop
$m6CopiedState = Join-Path $m6TransferDir '.local-state'
node dist/ops/stateCheckRun.js $m6CopiedState
if ($LASTEXITCODE -ne 0) { throw 'Copied state check failed; stop transfer' }
$m6Names = @('monitor.sqlite','monitor.sqlite.guard.json','monitor.sqlite-wal','monitor.sqlite-shm')
$m6Manifest = foreach ($m6Name in $m6Names) {
  $m6File = Join-Path $m6CopiedState $m6Name
  if (Test-Path -LiteralPath $m6File) {
    $m6Digest = (Get-FileHash -LiteralPath $m6File -Algorithm SHA256).Hash.ToLowerInvariant()
    "$m6Digest  .local-state/$m6Name"
  }
}
$m6Manifest | Set-Content -LiteralPath (Join-Path $m6TransferDir 'SHA256SUMS') -Encoding ascii
tar -C $m6TransferDir -cf (Join-Path $m6TransferDir 'state-transfer.tar') .local-state SHA256SUMS
if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed; stop transfer' }
```

LocalAppData-копия наследует ACL пользователя; храните её приватно и не синхронизируйте
в публичное облако. Archive передайте согласованным SCP/SFTP в private staging inbox VPS.
Не вставляйте неизвестный SSH fingerprint вслепую. На VPS, только если указанные каталоги
ещё не существуют, выполните подготовку и распаковку **собственного trusted** archive:

```sh
sudo mkdir -m 0700 /var/lib/kwork-project-monitor-transfer
sudo tar -C /var/lib/kwork-project-monitor-transfer -xpf /APPROVED_PRIVATE_INBOX/state-transfer.tar
sudo sh -c 'cd /var/lib/kwork-project-monitor-transfer && sha256sum --check SHA256SUMS'
sudo mv /var/lib/kwork-project-monitor-transfer/.local-state /var/lib/kwork-project-monitor-incoming
sudo chown -R 1000:1000 /var/lib/kwork-project-monitor-incoming
sudo chmod 0700 /var/lib/kwork-project-monitor-incoming
sudo find /var/lib/kwork-project-monitor-incoming -type f -exec chmod 0600 {} +
```

`/APPROVED_PRIVATE_INBOX/state-transfer.tar` — путь полученного файла, его нужно заменить.
Каждая команда требует успешного результата предыдущей; при checksum failure STOP.
Если incoming уже существует, не выполнять mv: GNU mv может вложить каталог в существующий.
В новой установке final каталог создан в разделе 5, но обязан быть **пустым**. После
успешной staging-проверки ниже можно выполнить `sudo cp -a
/var/lib/kwork-project-monitor-incoming/. /var/lib/kwork-project-monitor/`, затем
проверить final той же утилитой. Никакие существующие файлы final не перезаписываются;
непустой final — повод остановиться и отдельно разобраться.

Проверка любой остановленной копии из собранного образа:

```sh
sudo docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --mount type=bind,src=/var/lib/kwork-project-monitor-incoming,dst=/app/.local-state \
  kwork-project-monitor:APPROVED_M6_COMMIT_SHA node dist/ops/stateCheckRun.js
```

Mount состояния здесь writable только для SQLite WAL/SHM bookkeeping; ledger/guard
утилита не пишет. `--mount` и Compose `create_host_path: false` не создают отсутствующий
host path. После проверки не должно появиться новых session/baseline/исторических чтений.
Разместите набор в final path только если он пуст и эта установка действительно первая;
иначе остановитесь и разберите существующее состояние. Сохраните исходный backup.

```sh
sudo chown -R 1000:1000 /var/lib/kwork-project-monitor
sudo chmod 0700 /var/lib/kwork-project-monitor
sudo find /var/lib/kwork-project-monitor -type f -exec chmod 0600 {} +
```

Операции выше применяются только к заранее проверенному точному каталогу проекта,
без symlinks и без посторонних файлов. Не используйте их на общем `/var/lib`.

**Защита имеет предел:** потеря/откат всего каталога с guard и смена пути не выявляют
потерю новых tombstones. Startup gate замечает пустую установку, но согласованный
старый DB+guard сам по себе выглядит валидным. Происхождение копии и current guard
проверяются оператором. Миграция не должна превращаться в восстановление старого backup.

## 8. Первый запуск OFF, остановка и перезапуск

Только после разрешённого переноса, offline smoke и подтверждения единственного poller:

```sh
cd /opt/kwork-project-monitor
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env up -d --no-build bot
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env ps
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env logs --tail 50 bot
```

Ожидается сообщение запуска с «мониторинг выключен». State gate проверен до polling.
При restart-loop сразу `stop bot`; не ждите бесконечных попыток и не сбрасывайте state.

Проверьте mount без вывода environment:

```sh
sudo docker inspect kwork-project-monitor --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
sudo docker exec kwork-project-monitor node -e 'console.log(process.cwd())'
```

Ожидаются `/var/lib/kwork-project-monitor -> /app/.local-state` и `/app`.
Наличие контейнера в состоянии Up не доказывает работоспособность Gmail/доставки.
В разрешённом owner-private чате `/ping` должен вернуть pong, `/monitor status` —
enabled=false/running=false. `storageOpen=false` и нулевые counts после restart
не означают, что persistent ledger пуст: M5 открывает его лениво. Gate проверил
данные отдельно. `/start` не активирует мониторинг.

Остановка и обычный restart:

```sh
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env stop bot
sudo docker inspect kwork-project-monitor --format 'running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
```

Убедитесь running=false, без SIGKILL/exit137/OOM. Затем проведите offline state check
final каталога командой из раздела 7 с заменой incoming на final.
`restart bot` допустим для уже разрешённого poller; он снова начинает OFF.
Не используйте второй `docker run` production образа для проверки живого бота.

## 9. Backup: остановить writer, проверить, скопировать

Raw copy живой SQLite небезопасен: актуальные commits могут быть в WAL. SQLite online
backup API согласует сам DB, но не внешний guard/session на другом моменте времени.
M6 не реализует hot-backup protocol. Здесь короткое окно остановки обязательно,
даже если мониторинг был OFF: сначала остановите весь процесс.

```sh
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env stop bot
sudo docker inspect kwork-project-monitor --format '{{.State.Running}}'
```

После false и подтверждения отсутствия прочих копий проверьте final state через
offline checker. Ошибка — STOP без копирования в качестве «валидного backup».

```sh
M6_BACKUP_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
M6_BACKUP_DIR=/var/backups/kwork-project-monitor/$M6_BACKUP_STAMP
sudo mkdir -m 0700 "$M6_BACKUP_DIR"
sudo tar -C /var/lib/kwork-project-monitor -cpf "$M6_BACKUP_DIR/state.tar" .
sudo cp -p /var/lib/kwork-project-monitor/monitor.sqlite.guard.json "$M6_BACKUP_DIR/current.guard.json"
sudo chmod 0600 "$M6_BACKUP_DIR/state.tar" "$M6_BACKUP_DIR/current.guard.json"
sudo sh -c 'cd "$1" && sha256sum state.tar current.guard.json > SHA256SUMS && chmod 0600 SHA256SUMS' sh "$M6_BACKUP_DIR"
```

`mkdir` без -p откажет при совпавшем timestamp, не перезапишет предыдущий backup.
Guard отдельно — контрольная точка на момент backup; при restore нужен ещё более
новый **текущий** guard из действующего каталога, если после backup были операции.
Запишите рядом approved Git SHA, Node digest, app image ID и время без secrets.
Для проверки archive создайте новый private каталог, например
`/var/backups/kwork-project-monitor/CHECK_TIMESTAMP`, распакуйте туда state.tar через
`sudo tar -C /var/backups/kwork-project-monitor/CHECK_TIMESTAMP -xpf
"$M6_BACKUP_DIR/state.tar"`, выставьте UID/GID 1000:1000 и проверьте этот каталог
offline checker из раздела 7. Каталог CHECK_TIMESTAMP должен быть новым и пустым;
используйте настоящее время вместо placeholder. Это
проверка чтения/schema/baseline/guard, не разрешение rollback старых tombstones.

Храните хотя бы одну зашифрованную копию вне этого VPS с контролем доступа; backup
на том же диске не спасает от потери VPS. Secrets резервируются отдельно владельцем
через его менеджер секретов, не в state archive. Периодичность: перед каждым update,
перед обслуживанием и регулярно после разрешённой работы; retention удаляет только
точно выбранные проверенные backups по отдельному решению владельца, без autodelete.

Если poller уже разрешён и обслуживание предполагает его возврат:

```sh
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env up -d --no-build bot
```

После backup мониторинг снова OFF. Автоматически слать `/monitor on` скриптом нельзя.

## 10. Обновление и откат образа

1. Проверьте текущие SHA/образ/paths, свободный диск и отсутствие dirty checkout.
   Зафиксируйте старые KWORK_RELEASE, KWORK_NODE_IMAGE и image ID в private ops note.
2. `git fetch origin`, изучите одобренный diff. Если есть изменение SQLite schema
   или semantics — этот runbook не разрешает migration; сначала отдельный план.
3. Остановите bot, выполните раздел 9 и offline check; **state не удаляется**.
4. Checkout конкретного нового approved SHA. В nonsecret compose.env поменяйте
   KWORK_RELEASE; при необходимости отдельно обновите Node digest. Пути и secrets сохраняйте.
5. Build, network-none smoke и signal smoke. При ошибке production не запускать.
6. `up -d --no-build bot`, проверить mount, логи и owner status OFF. После мягкой
   остановки offline check подтверждает, что baseline/guard читаются; не создавать baseline.
7. Включение scheduler — отдельное решение владельца после приёмки M5.

Не используйте docker system prune, удаление state, пересоздание volume или `down -v`
как способ обновления. Даже если этот bind mount не удалится от down -v, такая команда
не нужна и при будущих изменениях конфигурации опасна. Старый образ сохраняем до приёмки.

При неудачном update: остановить новую копию, проверить state; вернуть старый SHA
checkout и старый KWORK_RELEASE в compose.env, оставив **текущий state**. Запустить
старый локально сохранённый образ через `up -d --no-build bot`. Если образ утрачен,
пересборка старого SHA с тем же pinned base digest требует повторного offline smoke.
Не восстанавливайте вчерашний DB ради code rollback. Несовместимость старого кода с
текущей schema блокирует rollback и требует отдельного обслуживания.

## 11. Восстановление данных без обхода guard

Restore не равен image rollback. Старый согласованный backup может потерять проекты,
отправленные после него. При сохранённом более новом guard такой restore **запрещён**.

1. Остановить все копии, зафиксировать ошибку безопасным кодом. Сохранить весь текущий
   каталог (даже повреждённый) и его guard отдельно, не перезаписывая их backup-версией.
2. Проверить checksum выбранного trusted archive. Распаковать только собственный archive
   в новый пустой private каталог `/var/lib/kwork-project-monitor-recovery`.
3. Offline проверить восстановленную копию, затем сравнить её с independently retained
   current guard. Для этого bind обоих каталогов, без secrets/сети:

```sh
sudo docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --mount type=bind,src=/var/lib/kwork-project-monitor-recovery,dst=/recovery \
  --mount type=bind,src=/var/lib/kwork-project-monitor,dst=/current,readonly \
  kwork-project-monitor:APPROVED_M6_COMMIT_SHA \
  node dist/ops/stateCheckRun.js /recovery /current/monitor.sqlite.guard.json
```

`deployment_restore_refused` — STOP. Нельзя откатывать current guard для прохождения
проверки. При missing/corrupt current guard либо потере всего каталога локально нельзя
доказать сохранение всех tombstones; обычный автоматический restore не разрешён.
Нужно отдельное решение владельца о восстановлении из более свежего надёжного источника
или ручном сохранении tombstones. Никакой «создать новый baseline» в runbook нет.

4. Если проверка проходит и восстановление отдельно одобрено, оригинал остаётся в
   quarantine-каталоге; кандидат размещается в original final path, получает UID/GID
   1000, mode 0700/0600. Не смешивайте старый WAL с новым DB. Повторите checker перед startup.
5. Запустить одну копию OFF, проверить mount/Telegram status. Реальные данные не
   восстанавливались в этой сессии; drill performed только на synthetic state.

## 12. Диагностика и reboot

Логи приложения содержат фиксированные statuses/counts; Docker json-file ограничен
10 MiB × 3. В них не должны попадать raw errors, .env, body, project titles, message IDs
или account address. Не включайте debug/HTTP tracing. Не публикуйте state или stdout
credential-bearing сторонних диагностических команд.

| Симптом/код | Действие |
| --- | --- |
| deployment_state_missing | Остановить restart-loop; проверить mount/final path и полный перенос DB+guard. Не создать новую базу. |
| deployment_state_invalid | Проверить trusted backup, version/checksum и согласованность guard; не удалить данные и не подменить guard. |
| deployment_state_busy / storage_busy | Убедиться, что все pollers остановлены. Foreign session/PID reuse после аварии требуют отдельно разрешённого targeted repair; команды удаления session здесь нет. |
| deployment_binding_mismatch | Владелец проверяет те же owner/account в secret file приватно. Не пересоздавать ledger. |
| deployment_baseline_missing | Перенесена неподходящая/неполная база. Найти существующий baseline, не повторять его создание. |
| deployment_configuration_error | Владелец сверяет обязательные имена/format raw и permissions без показа values. |
| Gmail access/history_expired/overflow | Monitoring OFF; отдельное расследование. Не `baseline confirm` ради устранения ошибки. |
| Нет уведомлений после reboot | Проверить OFF status; это ожидаемый opt-in reset, не доказательство пустого ledger. |
| Exit 137 / OOMKilled=true | Проверить память/диск, сохранить state, провести offline check; после SIGKILL возможны dirty session/guard. |
| Ошибка polling/конфликт | Проверить отсутствие локального/другого VPS/smoke poller с тем же token. Не перевыпускать token автоматически. |
| Up, но /ping молчит | SSH/DNS/исходящий HTTPS/Telegram/owner guard; не включать Gmail scheduler для диагностики. |

После разрешённого reboot VPS:

```sh
sudo systemctl is-active docker
cd /opt/kwork-project-monitor
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env ps
sudo docker compose --env-file /etc/kwork-project-monitor/compose.env logs --tail 50 bot
sudo docker inspect kwork-project-monitor --format 'running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
df -h /var/lib/kwork-project-monitor
free -m
timedatectl status
```

Проверить mount и разрешённый owner `/ping`, status OFF. Чистое завершение Ubuntu
обычно даёт контейнеру SIGTERM, но поведение shutdown deadline и power loss нужно
проверить на выбранном VPS. Успешный локальный unit test не доказывает reboot acceptance.

## 13. Проверки подготовки и оставшиеся gates

Результаты подготовки и продолжения Docker-проверок (2026-10-13):

| Проверка | Результат |
| --- | --- |
| npm run typecheck | PASS локально ранее и свежий PASS в Linux test-stage Node 24.21.0 |
| npm test | PASS: 599 тестов, 35 файлов; свежий Linux network-none запуск с --maxWorkers 2 |
| npm run lint | PASS локально ранее и свежий PASS в Linux test-stage |
| npm run build | PASS локально ранее и в production Docker build |
| npm audit | PASS: 0 vulnerabilities; public registry доступен при разрешённом выходе из sandbox |
| npm audit --omit=dev | PASS: 0 vulnerabilities |
| Compose config --no-env-resolution --quiet | PASS на Compose 5.1.3 с public шаблоном |
| node deploy/offline-smoke.mjs | PASS: compiled JS, synthetic SQLite/mock lifecycle, вне Docker |
| Docker info/version | PASS: Engine 29.4.3, Linux amd64, Docker Desktop 4.74.0 |
| Docker build | PASS: production образ на pinned Node 24.21.0 |
| Container offline/signal smoke | PASS: network none, synthetic SQLite/mock lifecycle, SIGTERM exit 0 |
| Compose isolated up/recreate/restart/stop | PASS: только отдельный synthetic project; production CMD переопределён |
| Persistent bind state | PASS: baseline/epoch/floor, sent tombstone/counts после restart и recreate; чистые session/guard |
| UID/GID/root filesystem | PASS: 1000:1000; other UID EACCES; root filesystem EROFS |
| Build context | PASS после исправления directory exception: 53 allowlisted файла, никаких env templates/state/private files |
| Runtime image/layers | PASS: 10 слоёв, 94 application files; forbidden paths/типичных secret patterns нет; credentials keys в image env отсутствуют |
| Production dependencies | PASS: Google/grammY/parser imports при memory 512m без credentials/сети |
| VPS, реальное состояние, Gmail/Telegram, reboot | НЕ ПРОВЕРЯЛИСЬ; отдельное разрешение |

Предыдущий Codex Security source review сохранён отдельно; продолжение проверяет
последние Docker-файлы и helper. Фактический context test нашёл, что `!deploy/`
разрешал также два безопасных env template; добавлено `deploy/**` перед точным
разрешением smoke. Для src также явно исключены descendants перед разрешением *.ts.
Реальные secrets не были обнаружены; исправление предотвращает попадание будущих
deploy/*.env в build context. Это исправление проверено экспортом context и повторной сборкой.
Reviewer заметил только завышенную формулировку plan о classifier в smoke — исправлена;
classifier реально проверяется существующими Vitest tests, не этим smoke.

Первый дополнительный Linux typecheck с memory 1536m исчерпал default V8 heap;
повтор с memory 2560m / NODE_OPTIONS=--max-old-space-size=1792 прошёл вместе с suite/lint.
Это лимиты только компиляции/test-stage, production Compose 512m не менялся.

Перед готовностью к публикации отдельно проверена копия HEAD плюс **только 14 файлов M6**,
без пяти прежних пользовательских Gmail/test изменений и HANDOFF. В Linux Node24.21
typecheck, **598 тестов / 35 файлов**, lint и build прошли. 599 выше относится ко всему
текущему рабочему дереву; один дополнительный тест принадлежит прежней пользовательской
работе. Проверка копии не меняла index, ветку или HEAD. Проверенный production image
собран из текущего рабочего дерева; после одобрения/публикации commit release image
собирается именно из этого SHA и снова проходит предусмотренный offline smoke.

Исторические 582 теста M5 не подменяют свежий результат M6.
Все тестовые данные — synthetic; настоящая SQLite не открывалась утилитой M6.

- Compose schema: проверять `--env-file deploy/compose.env.example config --no-env-resolution --quiet`.
- Node/typecheck/tests/lint/build/audit: выполнять штатные npm checks, без `.env`.
- Docker build/network-none runtime/signal smoke: отдельные gates при доступном Engine.
- Live transfer/Telegram/Gmail/VPS reboot: только с отдельным разрешением, не в offline preparation.
- Git publication: отдельный запрос владельца; M6 сейчас uncommitted.

Источники конфигурации: [официальный Docker Ubuntu install](https://docs.docker.com/engine/install/ubuntu/),
[Compose services](https://docs.docker.com/reference/compose-file/services/),
[Node sqlite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html),
[официальные варианты Node images](https://github.com/nodejs/docker-node/blob/main/versions.json).
Context7 использован для Node readOnly API и Compose raw env_file; ссылки сверены с
официальной документацией. Непроверенных придуманных параметров не используется.
