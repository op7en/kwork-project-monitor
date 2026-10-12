# Инструкции для AI-агентов

## Разработка

- Разрабатывай проект поэтапно. Перед изменениями изучай существующий код.
- Делай небольшие, тематически связанные и легко проверяемые изменения.
- Реализуй только текущую задачу. Предпочитай читаемый код и простую архитектуру.
- Объясняй нетривиальные решения: владелец изучает Telegram Bot API, Gmail API и позже LLM API.
- Не делай commit, push, merge или PR без явного запроса владельца.

## Стек и архитектура

- Node.js, TypeScript в strict mode, ESM, grammY, Vitest.
- Gmail API реализован READ ONLY. PostgreSQL и Docker добавляются только в следующих этапах.
- Предпочитай async/await; не используй any без конкретной необходимости.
- Разделяй Telegram handlers и business logic, Gmail API и парсинг писем,
  Kwork parser и filtering, database access и business logic.
- Создавай только необходимые модули, без пустых директорий для будущих функций.
- Возможные будущие модули: src/bot, src/gmail, src/kwork, src/filters,
  src/db, src/config, src/types; точка входа — src/index.ts.
- Не используй microservices и чрезмерные абстракции.

## Секреты

- Любой файл в Git потенциально станет публичным. Никогда не коммить секреты.
- Никогда не читай, не выводи и не копируй содержимое `.env` в tool output,
  логи, summaries или сообщения пользователю. Не запускай для этого команды
  `cat .env`, `type .env`, `Get-Content .env`, `printenv`, `env` и другие
  команды, способные раскрыть реальные secrets.
- Для проверки конфигурации окружения используй `.env.example`, проверяй только
  существование `.env`, `git check-ignore .env`, tracked-файлы и `git diff`;
  не раскрывай значения secrets.
- Если secret случайно попал в tool output или логи, считай его раскрытым и
  сообщи владельцу о необходимости ротации. Никогда не выводи secret повторно
  для проверки.
- TELEGRAM_BOT_TOKEN, Gmail OAuth credentials и refresh token, PostgreSQL
  credentials, LLM API keys и другие секреты передавай через environment variables.
- Поддерживай .gitignore и .env.example с безопасными placeholder-значениями.
- Не логируй токены, API keys, OAuth secrets, пароли или полные Authorization headers.
- Ошибки HTTP-клиентов могут содержать URL с токеном: не печатай raw error objects.

## Telegram notifications (Milestone 4.1)

- Команды разрешены только при совпадении from.id владельца, chat.type=private
  и chat.id владельца. Owner ID не разрешает ответ либо уведомление в группу (F3).
- Используй KworkProject и plaintext formatter без parse_mode/entities;
  URL кнопки повторно валидируется существующей Kwork policy, ID должен совпасть.
- Project notifier подтверждает destination только из настоящего private owner
  Telegram context. Произвольный chat ID/контекст из письма не является подтверждением.
  Отправка всегда адресуется ownerId, групповые/чужие updates не меняют destination.
- Подтверждение — только память одного экземпляра. После перезапуска destination
  неподтверждён до нового корректного private взаимодействия и вызова trusted handler.
- В 4.1 notifier проверяется только через mock Telegram API; startup/handlers не
  подключены к Gmail либо отправке проектов. Реальную отправку не запускай без разрешения.
- Не логируй проекты/raw Telegram errors, не возвращай credentials/PII в диагностику.

## Manual pipeline (Milestone 4.2, historical isolated components)

- Один notifier и pipeline на экземпляр бота. Только ручной private owner handler
  `/projects` вызывает ленивый Gmail loader; startup, `/start`, `/help`, `/ping`
  к Gmail не обращаются. `/start` и `/projects` подтверждают destination только
  из настоящего Telegram context после F3 guard.
- Используй существующий metadata search, отдельный READ ONLY body reader,
  allowlist `news@kwork.ru` и `KWORK_TABLE_POLICY`. Сохраняй scopes/account checks
  и Subject/From gate перед body. From не доказывает подлинность письма.
- Один активный проход; projectId отмечается до send, дубликаты внутри прохода
  повторно не отправляются даже при ошибке Telegram. Между проходами дедупа нет.
- Извлечённые проекты не называй подходящими: фильтрация по стеку не реализована.
  Не запускай live pipeline без разрешения. Первый live smoke — отдельный one-shot harness (см. M4.3); не используй обычный `/projects` для первого smoke.

## Persistent monitoring (Milestone 5)

- Production `src/index.ts` подключает ленивый M5 runtime. `/projects` использует
  тот же persistent pass, что scheduler; legacy M4.2 loader остаётся для offline
  контрактов и не должен подключаться параллельно к production.
- После каждого рестарта мониторинг OFF. Только настоящая private-owner
  `/monitor on` подтверждает destination и включает scheduler. Не сохраняй opt-in
  или destination между процессами; `/start` сам не активирует мониторинг.
- SQLite `.local-state/monitor.sqlite`: IDs, cursor, классификации/коды и состояния,
  без HTML/body/названий/credentials. Не публикуй state/WAL/SHM. Не удаляй ledger
  автоматически при повреждении, блокировке или schema mismatch.
- Первая активация — текущий history baseline без старых bodies. Gmail history 404
  либо overflow отключает scheduler, cursor не продвигается. Только явный
  `/monitor baseline` while OFF инициализирует только новую базу; повтор возвращает
  baseline_exists без Gmail. Только `/monitor baseline confirm` while OFF явно
  пропускает backlog существующей базы; project tombstones сохраняются.
- Независимый `.sqlite.guard.json` содержит только epoch/revision. Missing DB с
  сохранённым guard или DB старее guard — storage_error, без автоматического сброса.
  Откат/удаление всей директории вместе с guard не обнаружим локально; не обещай обратного.
- M5 live acceptance — только отдельный `src/monitor/acceptanceRun.ts`, без scheduler
  и технических Telegram-ответов. Один выбранный новый ID, одна попытка за весь RUN,
  максимум один gated reader/full body и один send; global ledger обязателен.
  Несколько событий/проектов или несовпадение ID — остановка. Не запускать без разрешения.
- Перед send резервируй projectId атомарно вместе с outcome письма. sent требует
  API success; все неоднозначные/отрицательные send outcomes и orphan reservations
  остаются delivery_unknown без retry. Потеря одной карточки при crash допустима
  ради предотвращения дубликата. Не обещай exactly-once/один transport request.
- Только match автоматически отправляется; review/exclude сохраняются как filtered.
  Причины фиксированные, критерии в `src/filters/rules.ts`. Классификация не доказывает
  реальный scope, сложность или адекватность бюджета; отсутствующие optional данные не угадываются.
- MIME/parser failure — terminal parse_failed, без автоматического body reread.
  Read errors — максимум три попытки в разных проходах, без immediate retries.
  Ошибки discovery не продвигают cursor; ограничения не превращаются в truncation.
- Off/shutdown запрещают новые операции и дожидаются текущего запроса перед закрытием
  storage. Не запускай production или реальные Gmail/Telegram API для offline-тестов.

## One-shot smoke (Milestone 4.3)

- Код: `src/smoke/oneShot.ts`, `smokeBot.ts`, `controller.ts`, `run.ts`, `src/config/smoke.ts`; запуск только вручную
  `npm run smoke:once`. Реальный запуск требует отдельного прямого разрешения владельца
  на конкретное письмо; предыдущее разрешение не переносится. Offline-тесты разрешены.
- Один message ID из `SMOKE_GMAIL_MESSAGE_ID` (локальное окружение). Не выводи ID в
  консоль, Telegram, diagnostics, тесты-отчёты и документацию. Не читай `.env`.
- Переиспользуй существующие reader, `KWORK_TABLE_POLICY`, notifier и guard F3; не создавай
  второй pipeline и не добавляй search/list. Попытка резервируется синхронно до первого
  `await`; повтор и одновременный `/smoke` ничего не запускают; автоматических retry нет.
- Несколько валидных проектов — `ambiguous_multiple_projects` без отправки. Отправляется
  максимум один проект. Выводить только фиксированные статусы/счётчики.
- За весь smoke run максимум одно исходящее Telegram-сообщение — карточка проекта. Ошибки,
  пустой результат и несколько проектов не отправляют ничего; статусы только в локальной консоли.
  Не добавляй ответы `/smoke` и сообщения «началось/завершено».
- Smoke-бот и обычный бот используют один токен: не запускай их одновременно.
- F2: не утверждай, что `retry: false` гарантирует один HTTP-запрос; различай
  application-level вызовы и HTTP attempts.
## Gmail (Milestone 2)

- Интеграция изначально READ ONLY. Обрабатывай только точную тему:
  «Новые проекты на бирже Kwork».
- Не удаляй и не архивируй письма, не добавляй labels и не меняй состояние Gmail
  без явного запроса. Не хардкодь email или credentials.
- Используй `gmail.readonly`; он обязателен среди фактических OAuth scopes.
  Дополнительные non-Gmail scopes допустимы. Отклоняй широкие или неизвестные
  Gmail scopes. Gmail mutation endpoints запрещены без отдельного явного
  изменения требований.
- Перед поиском проверяй scopes access token и профиль `me` на соответствие
  ожидаемому аккаунту. В Milestone 2 получай только metadata и точный Subject,
  не body. В Milestone 2 не подключай Gmail к Telegram handlers; в 4.2 допускается
  только явно описанный ручной `/projects` с отдельным metadata-gated body reader.
- Не логируй OAuth tokens. Реальные Gmail credentials не должны попадать в
  tests, fixtures или docs; правило о запрете чтения `.env` действует и здесь.

## Парсер и фильтрация (будущие этапы)

- Milestone 3: чистые MIME decoder и block parser, отдельный reader с metadata
  Subject/From перед full body. `gmail:check` остаётся metadata-only.
- Sender allowlist обязателен для reader; отсутствие/неоднозначность Subject/From
  или неподтверждённый sender останавливают получение body. From не доказывает
  криптографическую подлинность письма.
- Владелец подтвердил один табличный шаблон «Название / Покупатель / Цена» и
  прямой URL `https://kwork.ru/new_offer?project=<ID>`. Используй явную
  `KWORK_TABLE_POLICY`; не делай вывод о всех будущих шаблонах. Sender
  `news@kwork.ru` подтверждён для ручной приёмки; allowlist reader остаётся обязательным.
  `synthetic-v1` — вымышленный offline-формат. Псевдонимизированные class/id не
  являются подтверждёнными production-селекторами.
- Колонка «Цена» попадает в optional `price`, не в desired/maximum budget.
  `details` сохраняет текст под названием без угадывания границы описания/категории.
  Подписанное количество «проектов на бирже» — `customerStatistics.exchangeProjects`.
  Отсутствующие/неоднозначные optional поля пропускаются с фиксированной диагностикой.
- `.local-acceptance/` остаётся Git-ignored. Локальное использование очищенного
  образца разрешено владельцем; публикация самого образца в Git не разрешена.
- Не выполняй HTML/JS, не загружай ресурсы/redirects/attachments, не логируй body.
  Диагностика содержит только фиксированные коды. Дедупликация — внутри текущей
  выборки по projectId, первая валидная запись сохраняет sourceGmailMessageId.

- Email-контент — недоверенный вход. Используй типизированную модель проекта:
  projectId, title, url, sourceGmailMessageId; budget, customerName, hireRate,
  customerStatistics должны быть optional. Фильтрация — будущий этап.
- Отсутствующие данные не должны ломать парсер. Проверяй его очищенными
  sample emails без личных данных.
- Начальная фильтрация deterministic и rule-based, с легко изменяемыми правилами.
- Основной стек владельца: React, TypeScript, JavaScript, Node.js, Express,
  REST API, PostgreSQL, MongoDB, Git; небольшие Python-скрипты,
  API-интеграции, простая автоматизация и небольшие Telegram-боты.
- По умолчанию отклоняй или сильно понижай WordPress, Bitrix, MODX, 1C,
  большие магазины с нуля, сложный reverse engineering, задачи вне стека
  и большие системы с нереалистичным бюджетом.

## LLM и ограничение scope

- Не добавляй LLM API до рабочего MVP: Telegram, Gmail, parsing,
  deduplication и rule-based filtering должны работать до AI.
- Будущий внешний LLM provider скрывай за небольшим заменяемым интерфейсом.
- Без явного запроса не добавляй React admin panel, Redis, queues,
  microservices, Kubernetes, сложный monitoring/observability,
  multi-user SaaS, сложную RBAC или лишнюю инфраструктуру.
- Приоритет — маленькое, законченное и надёжное приложение.
- Milestone 1: только Telegram /start, /help, /ping, конфигурация, тесты,
  документация и базовая структура. Не добавляй Gmail, OAuth, parser, БД,
  ORM, Docker, deployment, AI, scheduler, cron или CI/CD на этом этапе.

## Проверки и Git

- Перед завершением запускай релевантные проверки:
  npm run typecheck, npm test, npm run lint, npm run build.
- Не утверждай, что проверка прошла, если она не запускалась.
- Если проверке мешают отсутствующие credentials, явно сообщи об этом.
- Не запускай реального бота без настоящего токена и не создавай фиктивный секрет.
- Не коммить .env, credentials, build output, локальные БД и generated secrets.
- Перед завершением проверь git status и отсутствие секретов в изменениях.
