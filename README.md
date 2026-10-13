# Kwork Project Monitor

Личный Telegram-бот для мониторинга проектов Kwork.
Проект разрабатывается поэтапно и предназначен также для портфолио.

## Текущий статус

**Milestone 1:** базовый Telegram-бот с `/start`, `/help`, `/ping`, конфигурацией,
тестами и документацией. Бот использует long polling: публичный сервер и webhook
для локального запуска не нужны.

**Milestone 2:** независимая Gmail READ ONLY интеграция через OAuth и отдельная
локальная команда `npm run gmail:check`. Она проверяет аккаунт и получает только
metadata писем с точной темой «Новые проекты на бирже Kwork».

**Milestone 3:** offline MIME decoder, block parser и отдельный metadata-gated
Gmail body reader. Поддерживается подтверждённый владельцем табличный шаблон
«Название / Покупатель / Цена» и прямая ссылка `https://kwork.ru/new_offer?project=<ID>`.
Локальная приёмка использует один обезличенный образец; это не доказывает поддержку
всех будущих вариантов уведомлений. Вымышленный `synthetic-v1` сохранён отдельно.
PostgreSQL и AI не реализованы. Постоянная дедупликация, deterministic filtering
и управляемый scheduler реализованы в Milestone 5 и проверены offline;
реальная автоматическая доставка M5 ещё не проверялась.
Production `/projects` использует тот же persistent проход, что и scheduler.

**Milestone 5 — offline-ready:** SQLite ledger переживает рестарт, Gmail discovery
использует `historyId` и bounded pagination, classifier возвращает `match/review/exclude`.
Автоматически отправляются только `match`. Мониторинг после каждого запуска выключен
до настоящей owner-private команды `/monitor on`. Первая активация сохраняет baseline
без чтения исторических bodies. Инструкции, state machine, ограничения и отдельный
live acceptance plan: [Milestone 5](docs/milestone-5.md).

**Milestone 6 — подготовка VPS:** добавлены Dockerfile, Compose и отдельный
контейнерный startup gate для существующих baseline/ledger/guard. Реальный сервер,
перенос состояния и production запуск требуют отдельного разрешения.
После каждого рестарта мониторинг остаётся OFF. Пошаговые установка, перенос,
обновление, backup, восстановление и ограничения проверки:
[Milestone 6](docs/milestone-6.md).

Отдельный временный FirstVDS вариант и synthetic test: [shared-host](docs/m6-shared-host-test.md).
Приватное редактирование ENV, offline validation и recreate одной копии:
[управление ENV](docs/m6-env-management.md). Итоговые угрозы и границы готовности:
[adversarial review](docs/m6-final-adversarial-review.md).

Для подтверждённого шаблона явно передавайте `KWORK_TABLE_POLICY` из
`src/kwork/parser.ts` в `parseGmailMessage` / `readKworkProjects`. Reader требует
caller-supplied sender allowlist; подтверждение `news@kwork.ru` в ручной приёмке
не отключает эту проверку и не доказывает криптографическую подлинность From.
`gmail:check` остаётся metadata-only, body автоматически не загружается.

Каждая запись извлекается из своей строки с тремя прямыми ячейками под точными
подписями колонок. Вложенные/объединённые неоднозначные ячейки пропускаются.
`price` — целая сумма RUB из колонки «Цена»; она не становится желаемым или
максимальным бюджетом. `details` хранит текст под названием, включая категорию:
неподтверждённую границу описания/категории парсер не угадывает. Статистика
`customerStatistics.exchangeProjects` и `hireRate` извлекается только по подписям
«проектов на бирже» / «нанято», из отдельных однозначных текстовых строк.

URL policy допускает только HTTPS, точный `kwork.ru`, путь `/new_offer` и один
`project` с положительным каноническим десятичным ID (до 80 цифр, без ведущих нулей).
Дополнительные query parameters, fragments, encoded значения, userinfo и явно
указанные порты отклоняются. Ссылки не открываются; URL из письма не реконструируется.
Служебные ссылки и классы `class-…` не используются как признаки проекта.

`npm run parser:check` работает offline с пустым окружением и демонстрирует
вымышленный `synthetic-v1` и полностью синтетическую таблицу подтверждённой формы.
Файлы ручной приёмки в `.local-acceptance/` игнорируются Git и не включены в тесты.
В tracked changes добавлен только независимо написанный synthetic table fixture.

**Milestone 4.1:** подготовка private Telegram-уведомлений. Все команды проходят
общий guard: `from.id` совпадает с владельцем, `chat.type` — `private`, `chat.id`
совпадает с ID владельца; групповой чат не является допустимым destination (F3 закрыт).
Formatter использует существующий `KworkProject`: название, optional `price`,
покупатель/подписанная статистика и `details`, кнопка «Открыть заказ». Прямой URL
повторно валидируется по подтверждённой Kwork policy; его ID должен совпадать с
`projectId`. Gmail provenance в Telegram-текст не включается.

Текст передаётся без `parse_mode`/`entities`, HTML/Markdown остаются буквальными
символами. Управляющие/bidi-символы удаляются, заголовок остаётся одной строкой;
длинный текст сокращается до 4000 UTF-16 единиц без разрыва surrogate pair.
Цена форматируется из нормализованной суммы RUB, не из недоверенного `raw`;
`budget` не переименовывается в цену. Link preview отключён.

`createProjectNotifier(api, ownerId)` возвращает `confirmDestination(ctx)` и
`send(project)`. Подтверждение принимает только настоящий Telegram context
владельца в его private chat; контекст нельзя восстанавливать из письма или
произвольного внешнего ввода. Групповые/чужие updates не могут подтвердить либо
заменить destination. Отправка всегда адресуется настроенному владельцу.
Без подтверждения возвращается `destination_unconfirmed`, для неверного проекта —
`invalid_project`, при ошибке API — `telegram_error`, при успехе — `sent`.
Raw errors, текст проекта и credentials не логируются; автоматического retry нет.

Подтверждение хранится только в памяти одного экземпляра sender. После перезапуска
новый экземпляр неподтверждён до нового корректного взаимодействия владельца
в личном чате и вызова `confirmDestination` его trusted handler. В 4.1 sender —
отдельный подготовленный API-модуль, проверенный с mock Telegram API. На момент
завершения 4.1 `src/index.ts` его ещё не создавал, команды не отправляли проекты.
Эта связь добавлена в 4.2 ниже. Настоящая отправка в 4.1 не проверялась.

**Milestone 4.2 (исторический контракт):** компоненты соединены в ручной pipeline. В M4.2 `src/index.ts` передавал
ленивый Gmail loader в `createBot`; один notifier и один pipeline создаются на
экземпляр бота. `/start` подтверждает destination из настоящего owner private
context, без Gmail-запросов. `/projects` также проверяет и подтверждает этот
context, затем запускает один проход. Startup, `/start`, `/help` и `/ping` не
создают Gmail-клиенты и не читают письма. После перезапуска подтверждение снова
отсутствует до нового корректного private взаимодействия.

Проход использует существующий ограниченный поиск metadata: до 50 кандидатов
и 5 страниц, до 5 писем в результате (новейшие внутри этой выборки, не гарантия
пяти последних во всём аккаунте). Scopes и ожидаемый аккаунт проверяются перед
поиском и повторно при создании отдельного body reader. Для body обязательны
точный Subject и allowlist `news@kwork.ru`; затем MIME → `KWORK_TABLE_POLICY` →
private notifier. Неподтверждённый destination останавливает pipeline до loader.
Никакие ссылки или attachments не загружаются.

Одновременно разрешён один проход на экземпляр: пересекающийся вызов получает
`busy`. `projectId` дедуплицируется внутри прохода; отметка делается до попытки
отправки, поэтому ошибка Telegram не вызывает повторную попытку дубликата.
Ошибка Gmail/configuration даёт безопасный `gmail_error`; ошибки отдельных
писем и парсинга возвращаются существующими диагностическими кодами. Отчёт в
личном чате содержит только счётчики и фиксированные коды, без Gmail ID/body/raw
errors. `completed` означает завершение прохода; диагностические коды и счётчик
ошибок могут указывать на частичный результат.

**Фильтрации по стеку нет:** извлечённые проекты не называются подходящими.
Постоянной дедупликации нет: повторный `/projects` может отправить те же проекты
снова. Scheduler и автоматический мониторинг отсутствуют. В 4.2 весь поток
проверен offline через synthetic Google responses и mock Telegram API;
живые Gmail/Telegram запросы в приёмке не выполнялись.

**Milestone 4.3:** реализован one-shot smoke helper на **одном заранее выбранном письме**
и максимум **одной попытке отправки одного проекта**. Контролируемый live-тест
12.10.2026 завершился успешно: один проект, одна карточка, подтверждение Telegram API
и владельца в личном чате. Каждый новый live-запуск требует отдельного разрешения.
Обычный `/projects` для smoke не используйте: его выборка
может содержать несколько исторических писем и проектов.

Локальная приёмка дополнительно сверяет выбранный ID с единственной записью candidate №1
в Git-ignored `.local-acceptance/live-smoke-candidates.json`. При несовпадении либо
отсутствующем/неоднозначном mapping результат `selection_mismatch` останавливает проход
до создания Gmail reader. Структурные счётчики выводятся только в локальную консоль;
ID, headers, HTML и данные проектов в них не попадают.

Запуск (только после отдельного разрешения владельца на конкретное письмо):
`SMOKE_GMAIL_MESSAGE_ID` задаётся в **локальном окружении** (ID не выводится ни в консоль,
ни в Telegram, ни в диагностику), затем `npm run smoke:once`. Поднимается временный
бот только с командой `/smoke`; перед стартом ожидающие updates сбрасываются
(`drop_pending_updates`), поэтому `/smoke` нужно отправить **после** сообщения
«Smoke-бот запущен». Без команды за 10 минут бот останавливается (код выхода 1), не обращаясь к Gmail; первая корректная команда `/smoke` отменяет этот таймаут, чтобы долгий Gmail-запрос не был прерван. Остановка выполняется также при успехе, любой ошибке и по SIGINT/SIGTERM; повторная остановка не выполняется.

Если сигнал остановки поступил во время startup, поздний `onStart` не создаёт
таймер и не печатает приглашение `/smoke`; новые команды не начинают Gmail-проход.
Уже начавшийся проход может завершиться: сигнал не отменяет текущий Gmail-запрос
или отправку карточки. Код выхода после прерывания остаётся 1.

> **Не запускайте smoke-бот и обычный бот одновременно.** Оба используют один
> `TELEGRAM_BOT_TOKEN`, а два процесса long polling конфликтуют. Сначала остановите
> production-бот. `drop_pending_updates` также удаляет накопившиеся, ещё не
> обработанные updates этого бота.

Порядок и гейты (`src/smoke/oneShot.ts`; любой отказ завершает работу до следующей
внешней операции): `/smoke` проходит тот же guard F3 (owner `from.id`, `private`,
`chat.id` владельца) и подтверждает destination по настоящему Telegram context →
единственная попытка резервируется синхронно, **до первого `await`** → формат ID →
подтверждённый destination (до любого Gmail-запроса) → существующий reader: scopes,
ожидаемый аккаунт, metadata-gate (exact Subject, From из allowlist `news@kwork.ru`),
затем `format=full` → MIME → `KWORK_TABLE_POLICY` → ровно один проект →
`notifier.send`. Поиска/list нет. Повторный или одновременный `/smoke` ничего не
запускает; попытка расходуется даже при раннем отказе, автоматических повторов нет.
После отчёта бот останавливается. Код завершения 0 только при `sent`.

Статусы: `sent`, `telegram_error`, `invalid_project`, `invalid_message_id`,
`destination_unconfirmed`, `already_used`, `gmail_error`, `no_project`,
`ambiguous_multiple_projects` (несколько валидных проектов — ничего не отправляется,
проект не выбирается), `internal_error` (неожиданный сбой, без деталей).

**Telegram-трафик за весь запуск: максимум одно исходящее сообщение** — карточка
проекта с кнопкой «Открыть заказ», и только при статусе `sent` (при `telegram_error`
это одна неудавшаяся попытка). При любой ошибке, отсутствии проекта или нескольких
проектах бот ничего не отправляет: ни ответа на `/smoke`, ни сообщений «началось» /
«завершено». Статус, счётчики и фиксированные коды диагностики выводятся только в
локальную консоль. Повторные и одновременные `/smoke` тоже молчат.

**Что гарантируется и что нет (F2).** На уровне приложения: один ID, один вызов
reader, не более одного `format=full` и один вызов отправки проекта. Reader по
своему дизайну делает два application-level запроса `messages.get`: `metadata`, затем
`full`. Это не то же самое, что число реальных HTTP attempts. Статический разбор
установленных `gaxios` 7.3.1 / `googleapis-common` 9.1.0 / `google-auth-library` 11.1.0:
для Gmail-вызовов `retry: false` отключает retry gaxios (нет `retryConfig`), а
повторная отправка при 401/403 в OAuth2Client требует сохранённого `access_token`
без `expiry_date` либо `forceRefreshOnFailure` — наш клиент этого не задаёт.
Однако обращения к OAuth-эндпоинтам (token refresh/tokeninfo) используют
`OAuth2Client.RETRY_CONFIG`, и отсутствие транспортных повторов на уровне HTTP
реальным запуском **не подтверждено**. Mock-тесты видят только вызовы
приложения, не сокет. Поэтому строгая гарантия «ровно один HTTP-запрос с body»
не заявляется; Gmail client не переписывался (F2 остаётся отдельным долгом).
Для Telegram автоматического retry в приложении нет (плагин auto-retry не
подключён), но при сетевой ошибке доставка может оказаться неоднозначной.

Фильтрации по стеку нет, постоянной дедупликации и scheduler тоже нет. Тесты M4.3
полностью offline (synthetic Google responses и mock Telegram API).

## Стек

- Node.js и TypeScript (strict mode, ESM).
- grammY для Telegram Bot API.
- Официальный `googleapis` для Gmail API и OAuth2.
- Vitest для тестов без Telegram API.
- ESLint и typescript-eslint.
- tsx для запуска TypeScript в разработке.

TypeScript закреплён на совместимой стабильной ветке 6.0:
используемая версия typescript-eslint пока требует TypeScript ниже 6.1.
`package-lock.json` фиксирует точные версии всех установленных зависимостей.

## Требования

- Node.js **24.x** или **26+**; npm.
- Доступ к Telegram API для реального запуска.
- Настоящий токен бота от [@BotFather](https://t.me/BotFather).

Для тестов, typecheck, lint и сборки токен не нужен.

## Установка

Откройте папку проекта в терминале и установите зависимости:

```bash
npm ci
```

Если локальной копии нет, после появления кода на GitHub её можно будет получить:

```bash
git clone https://github.com/op7en/kwork-project-monitor.git
cd kwork-project-monitor
npm ci
```

Репозиторий пока приватный: для клонирования нужен доступ к нему.

## Настройка Telegram и .env

1. Откройте [@BotFather](https://t.me/BotFather) и отправьте `/newbot`.
2. Выберите имя и username бота и получите токен.
3. Скопируйте `.env.example` в `.env` в корне проекта.

Linux / macOS:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

4. Замените `your_telegram_bot_token_here` в `.env` настоящим токеном BotFather.
5. Замените `123456789` в `TELEGRAM_OWNER_ID` на свой числовой Telegram user ID.

Бот теперь **single-user**: команды `/start`, `/help` и `/ping` обрабатываются
только для указанного владельца. Запросы от остальных пользователей молча
игнорируются. Owner ID обязателен и должен быть положительным безопасным целым
числом. При отсутствии или некорректном значении приложение завершится с
понятной `ConfigError` до запуска Telegram polling.

Токен читается только из `TELEGRAM_BOT_TOKEN`. Скрипты `dev` и `start` загружают
`.env` встроенным механизмом Node.js (`--env-file-if-exists`), поэтому dotenv
не требуется. Уже заданная переменная окружения имеет приоритет над `.env`.

Отсутствующий или пустой токен, незаменённый пример и отсутствующий или
некорректный owner ID приводят к понятной ошибке до обращения к Telegram. Само
отсутствие файла `.env` допустимо, если обе переменные переданы через окружение.

Не отправляйте токен в чат, не добавляйте `.env` в Git. Если токен утёк,
перевыпустите его через BotFather. В логах приложения секреты не выводятся.

## Gmail READ ONLY: Google Cloud и OAuth

Gmail проверяется отдельно от Telegram. Отсутствие Gmail credentials не мешает
запуску Telegram-бота с его двумя переменными. Команда `gmail:check`, наоборот,
требует только Gmail-конфигурацию; Telegram token для неё не нужен.

1. Создайте отдельный проект в [Google Cloud Console](https://console.cloud.google.com/).
2. В **APIs & Services → Library** включите **Gmail API** для этого проекта.
3. Настройте **Google Auth Platform**: Branding, Audience и Data Access.
   Для личного smoke-test с External/Testing добавьте собственный Gmail-аккаунт
   в Test users. Если используете Workspace Internal, это зависит от политики
   вашей организации.
4. Добавьте единственное запрашиваемое Gmail-разрешение:
   `https://www.googleapis.com/auth/gmail.readonly`.
5. В **Clients** создайте OAuth client типа **Web application** для ручной
   настройки через OAuth Playground. В Authorized redirect URIs добавьте точно
   `https://developers.google.com/oauthplayground`.
6. Сохраните client ID и client secret локально. Не добавляйте скачанный JSON
   credentials в репозиторий. Приложение использует environment variables,
   а не читает credentials-файлы.

Порядок настройки Google Cloud описан также в официальном
[Gmail quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs).
Встроенный OAuth-сервер или отдельный OAuth framework в этом проекте не нужны.

### Получение refresh token вручную

1. Откройте [официальный OAuth Playground](https://developers.google.com/oauthplayground/).
2. В настройках выберите **Use your own OAuth credentials**, вставьте client ID
   и client secret своего проекта; оставьте Google endpoints, Server-side,
   Access type **Offline** и Force prompt **Consent Screen**.
3. В Step 1 введите только `https://www.googleapis.com/auth/gmail.readonly`,
   нажмите **Authorize APIs** и выберите именно ожидаемый аккаунт.
4. В Step 2 нажмите **Exchange authorization code for tokens**. Сохраните
   refresh token только в локальном `.env` или безопасном окружении процесса.
   Access token копировать в проект не требуется: SDK получает и обновляет его.

Playground передаёт credentials Google для обмена токенов. Не используйте
сторонние генераторы токенов, не делитесь Playground links с включёнными
credentials/tokens. Используйте собственный OAuth client: встроенные credentials
Playground выдают refresh tokens с ограничением 24 часа.

Если этому OAuth client раньше давали широкие Gmail-права, отзовите его прежний
доступ в настройках Google Account и заново выдайте только readonly-разрешение.
Клиент проверяет фактические scopes access token, а не локально записанное имя
scope: `gmail.readonly` обязателен, non-Gmail scopes (например openid/email/profile)
допустимы. Широкие или неизвестные Gmail scopes приводят к отказу до чтения
профиля. Из дополнительных Gmail scopes разрешены только известные read-only
`gmail.metadata` и `gmail.addons.current.message.readonly`.

У External приложения со статусом **Testing** refresh token с Gmail scope
обычно истекает через 7 дней. Для повторного smoke-test получите новый token;
это ограничение Google, не ошибка парсинга. Для будущего постоянного применения
нужно отдельно разобраться с publishing/verification и политиками Google;
deployment в текущий milestone не входит. См.
[refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

### Локальная конфигурация и smoke-test

Добавьте в уже существующий `.env` четыре строки из `.env.example`, заменив
placeholders своими значениями. Сохраните существующие Telegram-настройки:

```dotenv
GMAIL_CLIENT_ID=your_google_client_id
GMAIL_CLIENT_SECRET=your_google_client_secret
GMAIL_REFRESH_TOKEN=your_google_refresh_token
GMAIL_EXPECTED_ACCOUNT_EMAIL=your_email@example.com
```

`GMAIL_EXPECTED_ACCOUNT_EMAIL` — адрес того аккаунта, которому принадлежит
выданный refresh token. Все четыре переменные обязательны для Gmail check;
пустые значения, примеры и некорректный email отклоняются до обращения к API.
**OAuth credentials, client secret и refresh token никогда не должны попадать
в Git, tests, fixtures, docs, сообщения или логи.** Не выводите содержимое `.env`.

После настройки запустите вручную из корня репозитория:

```bash
npm run gmail:check
```

Пример успешного вывода (число может быть 0):

```text
Gmail connection: OK
Account: verified
Matching Kwork emails: 3
```

Порядок: refresh token → access token → проверка фактических scopes →
`users.getProfile(me)` → сравнение email без учёта регистра → поиск → metadata.
При другом аккаунте поиск не начинается. Query предварительно выбирает кандидатов;
затем Subject сравнивается **точно** с «Новые проекты на бирже Kwork».

Запрашиваются только id, threadId, internalDate и Subject через
`format=metadata` и ограниченный `fields`. Body, attachments и snippets не
запрашиваются. Письма не меняются и не помечаются прочитанными.
Проверка рассматривает до 50 кандидатов и пяти страниц, сортирует совпадения
по дате и возвращает до пяти писем. Это число совпадений в ограниченной выборке,
а не полный счётчик ящика и не гарантия пяти самых новых писем во всём Gmail.

При ошибке команда завершится с кодом 1 и безопасным сообщением. Успех и ноль
совпадений означает рабочее подключение без подходящих писем в выборке.
Реальное подключение подтверждается вашим ручным запуском; automated tests
используют mocks и не обращаются к Google.

### Безопасная диагностика Gmail check

Ошибки содержат только этап, разрешённую категорию и, если он получен,
числовой HTTP status. Пример:

```text
Gmail check failed: stage=access_token; category=invalid_grant; http_status=400
```

Этапы: `configuration`, `access_token`, `oauth_scopes`, `profile`, `account`,
`messages_list`, `message_metadata`. ConfigError дополнительно указывает имя
некорректной переменной, без её значения. Не выводятся raw Google errors,
error descriptions, URL запросов, credentials, headers или адрес аккаунта.

- `invalid_grant` на этапе `access_token`: Google отклонил refresh grant;
  scopes и Gmail profile ещё не проверялись. Сам код ошибки не различает
  истечение/отзыв токена и несоответствие OAuth client. Проверьте Audience →
  Publishing status и время выдачи токена. В External/Testing учитывайте
  семидневный срок; использование встроенного клиента Playground ограничено
  24 часами. Сверьте локально, что client ID/secret принадлежат тому клиенту,
  который выбран в Playground. Затем выдайте refresh token через **Use your
  own OAuth credentials** для того же клиента и только `gmail.readonly`.
- `invalid_client`: проверьте OAuth client в Google Auth Platform → Clients
  и соответствие локальных client ID/secret текущим credentials этого клиента.
  Не создавайте новый токен, пока это несоответствие не устранено.
- `insufficient_scope` / `unsafe_gmail_scope` на этапе `oauth_scopes`:
  фактические Gmail permissions не подходят. Перевыдайте grant только с
  `gmail.readonly`, предварительно отозвав широкие права этого приложения.
- `account_mismatch`: выбран другой аккаунт или профиль не содержит email;
  проверьте ожидаемый аккаунт и заново авторизуйте именно его.
- `network_error` / `timeout`: проверьте HTTPS к `oauth2.googleapis.com` и
  `gmail.googleapis.com` на порту 443. Ошибка сети sandbox не доказывает
  отсутствие доступа из обычного терминала. Не отключайте системную защиту.
- `unknown_oauth_error` / `unknown_api_error` / `unknown_error`: причина
  не входит в разрешённый набор; raw error намеренно не показывается.

После исправления повторите `npm run gmail:check`. Добавляйте новые credentials
только локально; не присылайте их в чат и не выводите `.env` для диагностики.

## Milestone 3: offline parser

```bash
npm run parser:check
```

Команда не загружает `.env`, не требует credentials и не обращается к сети.
Выводит `fixture: synthetic-v1` с двумя проектами и отдельный
`confirmedTableExample` с двумя полностью синтетическими табличными проектами.
`kwork.example` и `/synthetic-project/` — вымышленные тестовые hostname/path.

`parseGmailMessage()` (`src/gmail/projects.ts`) принимает offline structured
payload. `readKworkProjects()` получает явно заданные message IDs через отдельный
reader: `createGmailProjectReader(config, confirmedSenders)`. Пустой/неверный sender
allowlist отклоняется до OAuth. Сохранены actual scopes и expected account gates.
До full body проверяются metadata: единственный exact Subject, единственный From,
совпадающий с allowlist, ID и sizeEstimate ≤ 1 MiB. Full ID/headers повторно
проверяются. From matching — фильтр, не криптографическая аутентификация.
Reader не предоставляет mutation/attachment methods. Live parser CLI не добавлен;
`gmail:check` по-прежнему получает metadata, без body.

Parser policy передаётся явно; production defaults отсутствуют. `synthetic-v1`
поддерживает непересекающиеся HTML cards по trusted selector, один `h2` с названием,
прямые project anchors и подписанные `p`-поля. Plain: отдельные параграфы
`Проект: ...` / `Ссылка: ...`, разделённые пустой строкой. Разные IDs в одном блоке
и вложенные карточки пропускаются; поля соседних карточек не объединяются.

Budget: fixed/range/up-to/from с raw text, только явно обозначенные целые рубли.
Общий `Бюджет`, `Желаемый бюджет`, `Максимальный бюджет` сохраняются отдельно.
Optional поля не угадываются. Synthetic labels: `Заказчик`, `Нанимает` (0–100%),
`Размещено проектов`, `Нанято проектов`. Для `kwork-table-v1` используются
подтверждённые `price`, `exchangeProjects` и `% нанято`, описанные выше.

MIME: plain/html, nested mixed/alternative/related, strict padded/unpadded
base64url, fatal decoding. Charset листа: UTF-8 по умолчанию; явные UTF-8,
windows-1251/cp1251, windows-1252/iso-8859-1, UTF-16LE/BE при поддержке ICU.
Выбирается отдельная HTML-версия с наибольшим количеством уникальных проектов, plain
используется как fallback только для подтверждённой соответствующей grammar
(`synthetic-v1`). Реальный plain-шаблон пока не подтверждён. Независимые mixed-сегменты обрабатываются отдельно;
альтернативы не объединяются. Attachment/forwarded subtrees исключены;
external text storage выдаёт `attachment_required` без загрузки.

Пределы обработки: 1 MiB decoded, 2 MiB encoded, MIME depth 16 / 128 parts,
DOM depth 64 / 10 000 elements, 100 blocks на письмо, 50 IDs на вызов. Это не
гарантированный network streaming cap. URLs требуют HTTPS, exact hostname/path
policy и positive decimal ID; userinfo, явные ports, fragments, encoded paths,
dot segments и redirects отвергаются. В `kwork-table-v1` разрешён ровно один query
parameter `project`; остальные query parameters не подтверждены и отвергаются.
HTML/JS/resources не исполняются и не загружаются. Inline CSS разбирается через
`css-tree` как список деклараций (лимит 16 KiB на атрибут), без рендеринга и загрузки
ресурсов. Комментарии и escapes в посторонних свойствах не делают элемент скрытым.
`display:none`, `visibility:hidden/collapse`, `mso-hide:all`, неизвестные выражения
видимости и неразбираемые декларации исключаются вместе с соответствующим поддеревом.
Diagnostics содержат только фиксированные коды, без body/headers/credentials.

Дедупликация: первый валидный projectId в порядке переданных писем/блоков сохраняет
своё sourceGmailMessageId; поля копий не объединяются. Постоянного processed state
нет; read/unread и labels Gmail не меняются.

### Ручная приёмка реального формата

Владелец подтвердил и разрешил локальную приёмку одного обезличенного письма с
одним проектом. После восстановления публичных подписей и `/new_offer?project=<ID>`
оно успешно разбирается локально. Файлы `.local-acceptance/` не публикуются и не
передаются внешним сервисам. В тестах — отдельно написанные полностью синтетические
данные с той же подтверждённой табличной семантикой. Расширение до нескольких строк
проверено на синтетических данных, не на отдельном реальном много-проектном письме.

Для дальнейшей проверки вариантов полезен обезличенный настоящий пример с
несколькими проектами и отсутствующими optional полями, с сохранёнными DOM-границами и plain
alternative, если есть; отдельно exact публичный From, Subject, Content-Type/charset.
Удалите To/Cc/Bcc, адрес получателя, личные IDs, Gmail IDs, tracking identifiers,
Received/Authentication-Results и любые токены. Названия и имена замените
синтетическими. Сохраните подписи, формат бюджета и структуру project URL
(hostname/path, с синтетическими IDs). `.env` и OAuth credentials не нужны.
Приёмка одного наблюдаемого шаблона не доказывает поддержку всех будущих вариантов Kwork.

Долг прошлого аудита: F1 Telegram initialization/shutdown, F2 Google SDK retry
policy, F3 private chat boundary перед notifications. В Milestone 3 не исправляется.
Отзыв прежних credentials технически не подтверждён.

## Разработка

Запускайте команды из корня проекта:

```bash
npm run dev
```

Node.js следит за изменениями исходников и перезапускает приложение.
После изменения `.env` остановите процесс и запустите его снова.

## Сборка и запуск

```bash
npm run build
npm run start
```

Сборка находится в `dist/`. `npm run start` требует предварительной сборки.
Остановка — `Ctrl+C` (SIGINT); SIGTERM также останавливает polling.
Запускайте только один экземпляр с одним токеном: два процесса long polling
конфликтуют между собой.

## Проверки

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm audit
```

Для тестов в режиме наблюдения:

```bash
npm run test:watch
```

Тесты проверяют переменные конфигурации, ответы реальных grammY-обработчиков
на искусственных Telegram updates, доступ только владельца, игнорирование
постороннего ввода и ненулевой код завершения при ошибке конфигурации.
Исходящие вызовы Telegram в тестах перехватываются на границе API;
реальный бот и реальные credentials не используются.
Gmail-тесты проверяют конфигурацию, scopes, аккаунт, точный Subject, ограниченную
pagination и безопасные ошибки через fake API boundary. Проверка CLI без
конфигурации использует пустое окружение и не загружает `.env`.

## Команды Telegram

| Команда | Результат |
| --- | --- |
| `/start` | Приветствие, назначение бота и текущие ограничения |
| `/help` | Список доступных команд |
| `/ping` | `pong` |
| `/projects` | Один persistent проход активированного M5 мониторинга; общая блокировка с scheduler |
| `/monitor on` | Свежая активация из личного чата; первый запуск — metadata-only baseline |
| `/monitor off` | Остановка новых операций, ожидание текущего запроса |
| `/monitor status` | Состояние и фиксированные счётчики; без Gmail |
| `/monitor baseline` | Первоначальная инициализация при OFF; повтор — baseline_exists без Gmail |
| `/monitor baseline confirm` | Явно пропустить backlog при OFF; существующие project tombstones сохраняются |

Бот принимает команды только от владельца, заданного через `TELEGRAM_OWNER_ID`,
в его личном чате. Команды владельца из групп/supergroups игнорируются.
Gmail metadata check запускается отдельно. Startup, `/start`, `/help`, `/ping` и
`/monitor status` не вызывают Gmail. `/monitor on`, `/monitor baseline`, включённый
scheduler и `/projects` являются live-операциями и требуют отдельного разрешения
для приёмки. Старые Telegram updates сбрасываются при startup, чтобы очередь
прошлого запуска не активировала мониторинг.

## Структура

- `src/bot/bot.ts` — создание бота и private handlers; импорт не запускает polling.
- `src/bot/privateChat.ts` — общий guard владельца и private destination.
- `src/bot/projectFormatter.ts` — чистая подготовка текста и проверенной URL-кнопки.
- `src/bot/projectNotifications.ts` — sender с подтверждением только в памяти и безопасными результатами.
- `src/bot/projectPipeline.ts` — один ручной проход, блокировка overlap и дедупликация перед отправкой.
- `src/config/env.ts` — чтение и проверка переменных окружения.
- `src/config/gmail.ts` — отдельная Gmail-конфигурация.
- `src/gmail/client.ts` — OAuth, проверка аккаунта и READ ONLY API boundary.
- `src/gmail/notificationProjects.ts` — ленивый loader с metadata search, sender allowlist и подтверждённой table policy.
- `src/gmail/kworkEmails.ts` — поиск и точная проверка Subject без body parsing.
- `src/gmail/check.ts` — отдельный локальный smoke-test CLI.
- `src/gmail/smokeCheck.ts` — проверка подключения и безопасный вывод CLI.
- `src/config/smoke.ts` — единственный `SMOKE_GMAIL_MESSAGE_ID` из окружения (M4.3).
- `src/smoke/oneShot.ts` — one-shot логика: одна попытка, гейты, один reader-вызов, максимум одна отправка.
- `src/smoke/smokeBot.ts` — временный бот только с `/smoke` и guard F3.
- `src/smoke/controller.ts` — завершение временного бота: код выхода, консольный отчёт, остановка при успехе/ошибке/таймауте.
- `src/smoke/run.ts` — ручной entry point `npm run smoke:once` (не запускать вместе с обычным ботом).
- `src/index.ts` — запуск, безопасная обработка ошибок и остановка.
- `src/monitor/store.ts` — SQLite ledger, атомарные reservations, session lock и restart recovery.
- `src/monitor/discovery.ts` — полная ограниченная history pagination с верхней границей.
- `src/monitor/pass.ts` — persistent проход, classifier и максимум одна попытка отправки projectId.
- `src/monitor/controller.ts` — memory-only opt-in, общий scheduler/manual проход и drain.
- `src/monitor/runtime.ts` — ленивые реальные adapters; конструктор не вызывает Gmail.
- `src/monitor/ledgerGuard.ts` — независимый epoch/revision guard против потери/отката только базы.
- `src/monitor/acceptance.ts`, `acceptanceBot.ts`, `acceptanceRun.ts` — отдельная ограниченная M5 live-приёмка без scheduler и технических Telegram-ответов; запуск только после разрешения.
- `src/config/monitor.ts` — интервал и строгие лимиты; окружение не активирует мониторинг.
- `src/filters/rules.ts` / `projectFilter.ts` — изменяемые правила и объяснимый classifier.
- `tests/` — проверки без сети и настоящего токена.
- `AGENTS.md` — постоянные правила работы AI-агентов.

Пустых директорий для будущих модулей нет.

## Roadmap

1. **Telegram bot** — Milestone 1, базовые команды.
2. **Gmail integration** — Milestone 2, READ ONLY metadata с точной темой Kwork.
3. **Kwork email parser** — типизированные проекты и очищенные тестовые письма.
4. **Telegram notifications** — M4.3, одна реальная карточка подтверждена.
5. **Persistent monitoring** — M5.1/M5.2, SQLite, rules и scheduler; offline-проверки.
6. **Live acceptance M5** — следующий отдельный этап, автоматическая доставка пока не подтверждена.
7. **Deployment** — постоянный запуск приложения.
8. **Optional LLM analysis** — дополнительный анализ после рабочего MVP.

PostgreSQL/ORM, deployment и LLM не входят в M5. Для single-user состояния используется
штатный `node:sqlite` без дополнительных npm-зависимостей или фоновых сервисов.
