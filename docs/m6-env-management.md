# Управление ENV после развёртывания

Команды этого документа выполняет владелец через доверенное SSH **после отдельного
разрешения настоящего deployment**. В текущей подготовке они проверяются лишь на
synthetic данных. Агент не читает реальные файлы, не наблюдает редактор и не получает
secrets в чат. FSP, его Compose, сети, volumes, Caddy и firewall здесь не участвуют.

## 1. Три разных вида управления

| Вид | Где хранится | Что задаёт |
| --- | --- | --- |
| Runtime ENV | `/etc/kwork-firstvds/bot.env`, root:root 0600 | Telegram/Gmail credentials, owner/account, interval и лимиты прохода |
| Compose settings | `/etc/kwork-firstvds/compose.env`, root:root 0600 | Одобренный SHA image, абсолютные пути secret/state; optional pinned Node base |
| Monitoring state | Только память процесса и owner-private Telegram commands | `/monitor on`, `/monitor off`, `/monitor status` |

ENV не включает мониторинг. `/start` не включает его. После restart/recreate мониторинг
OFF и destination неподтверждён. Возобновление владельцем `/monitor on` — отдельное
осознанное действие; агент этого не выполняет. SQLite baseline/cursor/tombstones не
являются ENV и не редактируются этой процедурой.

Обязательные runtime names: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`, `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_EXPECTED_ACCOUNT_EMAIL`.
Optional: `MONITOR_INTERVAL_MINUTES` (5..1440, default360), `MONITOR_MAX_MESSAGES`
(1..100, default100), `MONITOR_MAX_SENDS` (1..10, default10).
Owner ID и Gmail account должны оставаться теми, к которым привязан ledger; смена
credentials того же account допустима, смена account/owner требует отдельного проекта
и решения о состоянии. Не обходить binding отказ пересозданием baseline.

## 2. Формат и ограничения

Runtime использует Compose `env_file.format: raw` (Compose >=2.30), не Node dotenv:

- UTF8 без BOM, LF или CRLF, один явный `KEY=value` на строку, комментарии только
  отдельной строкой. Не `export`, не bare names, не повторные ключи.
- `$`, `${NAME}`, `#`, внутренние пробелы, `=`, одинарные/двойные кавычки в значении
  сохраняются буквально. Кавычки **не служат оболочкой значения**: добавленные вокруг
  настоящего token кавычки станут частью token. Не добавлять inline comments.
- Без переносов внутри значения, управляющих символов, пробелов снаружи value.
  Существующие app loaders используют trim, поэтому валидатор отвергает такие пробелы
  вместо молчаливой смены передаваемых bytes. Значения не более32KiB, файл не более64KiB.
- Только перечисленные runtime keys. `DEBUG`, `NODE_OPTIONS`, acceptance/smoke IDs,
  `MONITOR_ENABLED`, `KWORK_*` в bot.env отклоняются. Это предотвращает ошибочное
  представление об ENV opt-in и применение Node options до проверок.
- Compose settings — другой parser с interpolation. Поэтому здесь разрешены только
  буквальный SHA40, безопасные абсолютные Linux paths без `$`, `#`, кавычек, пробелов,
  `..`/`.` components, и optional точный Node digest. Credentials в него не помещать.

Validator проверяет документированный безопасный subset и фактические app loaders.
Он не подтверждает валидность token у Telegram/Google, фактические OAuth scopes,
доступ к аккаунту или правильность chosen state directory. Эти проверки требуют
отдельно разрешённого live этапа. Syntax OK не означает authentication OK.

## 3. Предварительные условия и начальная настройка

Нужен **новый опубликованный и проверенный image с `dist/ops/configCheckRun.js`**;
исторический ed41279 helper не содержит. Нельзя переименовать candidate в Git SHA.
До разрешения публикации текущий candidate только локальный, серверные команды STOP.
Image заранее доставляется без build на VPS. CODE — проверенный checkout этого
одобренного release; deployment records содержат SHA/architecture/image ID.

Нужны root maintenance права либо согласованное sudo. Если fspdeploy имеет только
разрешение Docker, не расширять sudoers самостоятельно: первоначальные каталоги/
editing подготовляет уполномоченный администратор. Ubuntu/Docker уже установлены;
здесь нет apt, systemctl restart, firewall или FSP operations.

Во всех примерах один фиксированный project и service:

```sh
set -eu
umask 077
CODE=/opt/kwork-project-monitor
CONF=/etc/kwork-firstvds
PROJECT=kwork-firstvds
BOT_ENV=$CONF/bot.env
COMPOSE_ENV=$CONF/compose.env
RELEASE=APPROVED_SHA_CONTAINING_CONFIG_VALIDATOR
test "${#RELEASE}" -eq 40
case "$RELEASE" in *[!a-f0-9]*) exit 1;; esac
IMAGE=kwork-project-monitor:$RELEASE
unset KWORK_RELEASE KWORK_SECRETS_FILE KWORK_STATE_DIR KWORK_NODE_IMAGE
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES
dc() { sudo docker compose --env-file "$COMPOSE_ENV" -p "$PROJECT" -f "$CODE/compose.yaml" -f "$CODE/deploy/compose.firstvds.yaml" "$@"; }
sudo docker image inspect "$IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
sudo docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  "$IMAGE" node -e 'if(!require("node:fs").existsSync("dist/ops/configCheckRun.js"))process.exit(1)'
```

Заменить placeholder RELEASE действительным одобренным SHA. Не использовать `source`,
`. file`, shell export credentials, обычный `docker compose config`, `--environment`,
`docker inspect Config.Env`, `env/printenv`, debug или shell tracing `set -x`.

Только для **первого создания**, при отсутствии старых файлов:

```sh
sudo test ! -e "$BOT_ENV"
sudo test ! -e "$COMPOSE_ENV"
sudo test ! -L "$BOT_ENV"
sudo test ! -L "$COMPOSE_ENV"
sudo install -d -m 0700 -o root -g root "$CONF"
sudo install -m 0600 -o root -g root "$CODE/deploy/bot.env.example" "$BOT_ENV"
sudo install -m 0600 -o root -g root "$CODE/deploy/firstvds.env.example" "$COMPOSE_ENV"
sudo nano "$BOT_ENV"
sudo nano "$COMPOSE_ENV"
```

Владелец вводит реальные значения приватно. Compose paths для этой установки:
`KWORK_SECRETS_FILE=/etc/kwork-firstvds/bot.env`,
`KWORK_STATE_DIR=/var/lib/kwork-firstvds/state`, `KWORK_RELEASE` = RELEASE выше.
State должен быть отдельно перенесён и проверен; эту процедуру не использовать для
создания новой БД. Не перезаписывать существующий ENV шаблоном. Editor backups могут
содержать secrets и остаются в private root directory; не переносить их в checkout.

## 4. Проверка без раскрытия values

Сначала проверяются сами файлы **без передачи их ENV в Node**. Это существенно:
иначе `NODE_OPTIONS` из ошибочного файла может сработать раньше validator.
Root validator читает только read-only mount ENV, без сети, БД и API; caps dropped.
File должен быть regular/root-owned0600. Host symlink проверить до bind, поскольку
Docker может разрешить symlink ещё до container lstat.

```sh
file_check() {
  sudo test -f "$1" && sudo test ! -L "$1" || return 1
  sudo docker run --rm --network none --read-only --user 0:0 \
    --cpus 0.25 --memory 384m --memory-swap 384m --pids-limit 64 \
    --cap-drop ALL --security-opt no-new-privileges \
    --mount "type=bind,source=$1,target=/run/input.env,readonly" \
    "$IMAGE" node dist/ops/configCheckRun.js --file /run/input.env "$2"
}
file_check "$BOT_ENV" runtime
file_check "$COMPOSE_ENV" compose
if dc config --no-env-resolution --quiet >/dev/null 2>&1; then
  printf 'compose_schema_ok\n'
else printf 'compose_schema_failed_STOP\n'; exit 1; fi
if dc config --quiet >/dev/null 2>&1; then
  printf 'compose_raw_resolution_ok\n'
else printf 'compose_raw_resolution_failed_STOP\n'; exit 1; fi
```

CLI выдаёт `env_configuration_ok` или фиксированный код, например
`env_missing:GMAIL_REFRESH_TOKEN`, `env_duplicate_key`, `env_syntax_invalid`,
`env_surrounding_whitespace`, `env_application_invalid`, `env_file_permissions`,
`env_file_unreadable`. Значения, paths и неизвестные raw key names в errors не выводятся.
`--no-env-resolution` не проверяет содержимое bot.env; поэтому нужны оба уровня.
Compose `--quiet` подавляет stdout, но parser errors в stderr способны показать input.
Поэтому команды Compose выше подавляют **оба** потока и выдают только fixed status.
При отказе смотреть файл приватно в редакторе, не публиковать сырой stderr.

Для первоначальной runtime injection проверки использовать отдельный nonsecret файл:

```sh
sudo test ! -e "$CONF/check.env"
printf 'KWORK_RELEASE=%s\nKWORK_SECRETS_FILE=%s\n' "$RELEASE" "$BOT_ENV" | sudo tee "$CONF/check.env" >/dev/null
sudo chmod 0600 "$CONF/check.env"
vc() { sudo docker compose --env-file "$CONF/check.env" -p kwork-env-check -f "$CODE/deploy/compose.env-check.yaml" "$@"; }
if vc run --rm --no-deps check >/dev/null 2>&1; then
  printf 'runtime_injection_ok\n'
else printf 'runtime_injection_failed_STOP\n'; exit 1; fi
```

Standalone check service не имеет state mount, ports, network, restart или polling.
Это не второй бот. Не объединять этот YAML с production Compose и не запускать его
до lexical file_check. `check.env` содержит только SHA/path; его создание не seed.
Для повтора использовать существующий проверенный check.env, не перезаписывать вслепую.

## 5. Изменение runtime ENV — staging и private backup

Во время редактирования старый процесс продолжает использовать прежние ENV.
Обычный `restart` **не применяет** изменения файла; нужен recreate.
Этот раздел меняет только runtime параметры. Compose SHA/node image/state path не
редактировать здесь: для них отдельные M6 release/migration процедуры и проверка
сохранности актуального состояния. Слепая смена state path может выбрать старую snapshot.

```sh
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP=$CONF/backups/$STAMP
STAGE=$CONF/staging/$STAMP
sudo test ! -e "$BACKUP"
sudo test ! -e "$STAGE"
sudo test ! -L "$BACKUP"
sudo test ! -L "$STAGE"
sudo install -d -m 0700 -o root -g root "$BACKUP" "$STAGE"
sudo install -m 0600 -o root -g root "$BOT_ENV" "$BACKUP/bot.env"
sudo install -m 0600 -o root -g root "$COMPOSE_ENV" "$BACKUP/compose.env"
sudo install -m 0600 -o root -g root "$BOT_ENV" "$STAGE/bot.env"
sudo install -m 0600 -o root -g root "$COMPOSE_ENV" "$STAGE/compose.env"
sudo nano "$STAGE/bot.env"
file_check "$STAGE/bot.env" runtime
file_check "$STAGE/compose.env" compose
sudo cmp -s "$STAGE/compose.env" "$COMPOSE_ENV"
printf 'KWORK_RELEASE=%s\nKWORK_SECRETS_FILE=%s\n' "$RELEASE" "$STAGE/bot.env" | sudo tee "$STAGE/check.env" >/dev/null
sudo chmod 0600 "$STAGE/check.env"
sv() { sudo docker compose --env-file "$STAGE/check.env" -p kwork-env-check -f "$CODE/deploy/compose.env-check.yaml" "$@"; }
if sv run --rm --no-deps check >/dev/null 2>&1; then
  printf 'staged_runtime_ok\n'
else printf 'staged_runtime_failed_STOP\n'; exit 1; fi
```

Backup — пара ENV файлов, **не SQLite backup**. Хранить root0700/0600, вне Git/build/
delivery, не в публичном облаке. Не показывать diff values. CHECK/STAGE пути не входят
в реальный persistent mount. Ни backup, ни staging не пересоздают Gmail baseline.

## 6. Применение только к одному bot

Предусловия: staged checks успешны, backup есть, image известен, Compose settings
не менялись, ownership контейнера совпадает, все другие экземпляры с тем же token
на этом VPS, локальном компьютере и других хостах
остановлены. Docker labels не доказывают отсутствие другого poller в интернете:
это подтверждает владелец. Никогда не запускать старый и новый poller для сравнения.

Следующие stop/mv/recreate команды изменяют работающий bot и его конфигурацию.
Последствия: downtime, сброс destination/monitor opt-in; ledger не заменяется.
Если stop не дал чистый exit, **STOP** до диагностики state/session/guard.

```sh
test "$(sudo docker inspect kwork-firstvds-bot --format '{{index .Config.Labels "com.docker.compose.project"}}')" = "$PROJECT"
test "$(sudo docker inspect kwork-firstvds-bot --format '{{index .Config.Labels "com.docker.compose.service"}}')" = bot
dc stop --timeout 90 bot
test "$(sudo docker inspect kwork-firstvds-bot --format '{{.State.Running}}')" = false
test "$(sudo docker inspect kwork-firstvds-bot --format '{{.State.ExitCode}}')" = 0
# Существующая state после stop: UID21001, без сети и secrets, не MonitorStore/seed.
sudo docker run --rm --network none --read-only --user 21001:21001 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount type=bind,source=/var/lib/kwork-firstvds/state,target=/app/.local-state \
  "$IMAGE" node dist/ops/stateCheckRun.js /app/.local-state
sudo test ! -e "$CONF/bot.env.next"
sudo test ! -L "$CONF/bot.env.next"
sudo install -m 0600 -o root -g root "$STAGE/bot.env" "$CONF/bot.env.next"
sudo mv -T "$CONF/bot.env.next" "$BOT_ENV"
file_check "$BOT_ENV" runtime
sudo cmp -s "$STAGE/bot.env" "$BOT_ENV"
if dc config --quiet >/dev/null 2>&1; then
  printf 'applied_compose_config_ok\n'
else printf 'applied_config_failed_STOP_bot_remains_stopped\n'; exit 1; fi
if dc up -d --no-deps --no-build --pull never --force-recreate bot >/dev/null 2>&1; then
  printf 'bot_recreated_check_runtime_next\n'
else printf 'bot_recreate_failed_STOP\n'; exit 1; fi
dc ps -a bot
sudo docker inspect kwork-firstvds-bot --format 'running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}'
dc logs --tail 30 bot
```

Atomic rename находится в том же CONF filesystem. Не менять CONF на произвольный путь,
не удалять .next при неожиданном наличии, не использовать `--remove-orphans`, down,
prune, scale или build. `up -d` success подтверждает создание контейнера, а не успешную
аутентификацию: проверить его состояние сразу и ещё раз через30s; restart=no не скрывает
неудачный запуск бесконечным циклом. Runtime логи приложения должны содержать только
фиксированные статусы/счётчики; не включать сторонний HTTP tracing/raw errors.
После разрешённого живого startup владелец проверяет private `/ping` и `/monitor status`
(OFF), без `/projects`, `/monitor on`, baseline или acceptance ради проверки ENV.

## 7. Ошибка применения и восстановление

Отсутствующая/пустая переменная, неверный owner/account, monitor limits, mount, schema,
session или guard: bot оставить stopped. Не менять state и не создавать новый baseline.
Ошибка Telegram auth, polling conflict или Gmail invalid_grant: synthetic validator
не может их подтвердить. Не делать автоматическую ротацию или retries.

Если новая копия успела начать работу, остановить только её и проверить Running=false;
не стартовать old process рядом. Для rollback нужны выбранный **успешный** private
backup и подтверждение, что его credentials ещё действительны:

```sh
dc stop --timeout 90 bot
test "$(sudo docker inspect kwork-firstvds-bot --format '{{.State.Running}}')" = false
file_check "$BACKUP/bot.env" runtime
file_check "$BACKUP/compose.env" compose
sudo cmp -s "$BACKUP/compose.env" "$COMPOSE_ENV"
sudo test ! -e "$CONF/bot.env.next"
sudo install -m 0600 -o root -g root "$BACKUP/bot.env" "$CONF/bot.env.next"
sudo mv -T "$CONF/bot.env.next" "$BOT_ENV"
file_check "$BOT_ENV" runtime
if dc config --quiet >/dev/null 2>&1; then printf 'rollback_config_ok\n'; else exit 1; fi
# Повторить state checker из раздела6; при crash/session/guard error STOP.
if dc up -d --no-deps --no-build --pull never --force-recreate bot >/dev/null 2>&1; then
  printf 'rollback_bot_recreated_check_runtime_next\n'
else printf 'rollback_failed_STOP\n'; exit 1; fi
dc ps -a bot
sudo docker inspect kwork-firstvds-bot --format 'running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
```

Восстановление ENV не восстанавливает старый SQLite snapshot. Если Compose settings
backup отличается, этот runtime-only rollback неприменим; нужен отдельный deployment
review, без случайной смены state path/image. Без credentials, считающихся действительными,
rollback не считается решением: оставить bot stopped и исправить credentials приватно.

## 8. Ротация и границы защиты

- Token перевыпущен BotFather: прежний token может быть отозван; возврат backup не
  вернёт доступ. Остановить старые экземпляры, owner размещает новый token через staging,
  выполняет checks/recreate одной копии. Проверка нового token реальная и отдельно разрешается.
- Gmail refresh token отозван/истёк или OAuth client изменён: offline syntax не проверяет
  grant. Владелец проходит отдельный OAuth процесс с `gmail.readonly`, тем же account и
  действующим client. Не читать почту для проверки Docker, не менять baseline.
- Новые owner/account не совместимы с нынешним binding; менять их как обычный ENV fix нельзя.
- Root и Docker administrators общего VPS могут прочитать env, файлы и backups. UID,
  dropped caps и0600 не защищают от администратора хоста. Необходимое доверие к Саве/
  другим администраторам — организационное; при неприемлемости выбрать отдельный VPS.
- Backups и editor temp тоже secrets. `.gitignore` блокирует `.env`, `*.env`, `*.env.*`
  и `*.env~` (public `*.env.example` разрешены), `.dockerignore` использует allowlist.
  Это страховка, не permission хранить реальные копии в checkout. Delivery создаётся
  только из image.tar, public YAML/probe и checksum manifest; ENV и backups туда не входят.

Проверенная семантика: Context7 Docker/Compose и Node24,
[Compose env_file](https://docs.docker.com/reference/compose-file/services/#env_file),
[Docker raw key/value parser](https://github.com/docker/cli/blob/master/pkg/kvfile/kvfile.go),
[Compose restart](https://docs.docker.com/reference/cli/docker/compose/restart/).
Node `--env-file` обрабатывает quotes/comments иначе; server procedure его не использует.
