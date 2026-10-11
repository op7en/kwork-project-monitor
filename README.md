# Kwork Project Monitor

Личный Telegram-бот для будущего мониторинга подходящих проектов Kwork.
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
PostgreSQL, постоянная
deduplication, filtering, notifications и AI ещё не реализованы.
Telegram-бот продолжает отвечать только на три существующие команды.

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
HTML/JS/resources не исполняются и не загружаются. Inline CSS с comments/escapes
консервативно исключается вместе с соответствующим поддеревом.
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

Бот принимает команды только от владельца, заданного через `TELEGRAM_OWNER_ID`.
Gmail check запускается отдельно; Telegram handlers не вызывают Gmail.

## Структура

- `src/bot/bot.ts` — создание бота и три обработчика; импорт не запускает polling.
- `src/config/env.ts` — чтение и проверка переменных окружения.
- `src/config/gmail.ts` — отдельная Gmail-конфигурация.
- `src/gmail/client.ts` — OAuth, проверка аккаунта и READ ONLY API boundary.
- `src/gmail/kworkEmails.ts` — поиск и точная проверка Subject без body parsing.
- `src/gmail/check.ts` — отдельный локальный smoke-test CLI.
- `src/gmail/smokeCheck.ts` — проверка подключения и безопасный вывод CLI.
- `src/index.ts` — запуск, безопасная обработка ошибок и остановка.
- `tests/` — проверки без сети и настоящего токена.
- `AGENTS.md` — постоянные правила работы AI-агентов.

Пустых директорий для будущих модулей нет.

## Roadmap

1. **Telegram bot** — Milestone 1, базовые команды.
2. **Gmail integration** — Milestone 2, READ ONLY metadata с точной темой Kwork.
3. **Kwork email parser** — типизированные проекты и очищенные тестовые письма.
4. **PostgreSQL + deduplication** — хранение проектов без повторной обработки.
5. **Rule-based filtering** — детерминированные правила под стек владельца.
6. **Telegram notifications** — доставка новых подходящих проектов владельцу.
7. **Deployment** — постоянный запуск приложения.
8. **Optional LLM analysis** — дополнительный анализ после рабочего MVP.

Milestone 2 заканчивается независимым Gmail smoke-test. Body parsing,
извлечение проектов, БД, AI, уведомления и инфраструктура добавляются отдельными
этапами после ручной проверки подключения.
