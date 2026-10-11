# Инструкции для AI-агентов

## Разработка

- Разрабатывай проект поэтапно. Перед изменениями изучай существующий код.
- Делай небольшие, тематически связанные и легко проверяемые изменения.
- Реализуй только текущую задачу. Предпочитай читаемый код и простую архитектуру.
- Объясняй нетривиальные решения: владелец изучает Telegram Bot API, Gmail API и позже LLM API.
- Не делай commit, push, merge или PR без явного запроса владельца.

## Стек и архитектура

- Node.js, TypeScript в strict mode, ESM, grammY, Vitest.
- PostgreSQL, Gmail API и Docker добавляются только в следующих этапах.
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
  не body. Не подключай Gmail к Telegram handlers.
- Не логируй OAuth tokens. Реальные Gmail credentials не должны попадать в
  tests, fixtures или docs; правило о запрете чтения `.env` действует и здесь.

## Парсер и фильтрация (будущие этапы)

- Email-контент — недоверенный вход. Используй типизированную модель проекта:
  id, title, url; budget, customerName, hireRate должны быть optional.
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
