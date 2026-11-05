# 03. Architecture options

Це **варіанти**, а не затверджений дизайн. Основний критерій: мінімум операційних витрат і низька складність.

## A. Швидкий прототип із n8n

```text
Telegram → n8n Trigger → validate user → parse/classify → n8n Data Table
                           ↑                         ↓
                  daily schedule 08:30 ← pending items
                           ↓
                  Telegram reflection → update record
```

- Плюси: швидке складання workflow, знайомий користувачу інструмент, мало коду.
- Мінуси: потрібен постійний n8n-hosting для webhook і scheduler; GitHub/Obsidian export треба зробити окремо.
- Рекомендований тест, якщо вже є можливість дешево хостити n8n.

## B. Невеликий serverless backend (без VPS)

```text
Telegram webhook → hosted Function/Worker → durable DB/storage
                        ↑                       ↓
                    daily cron → Telegram digest/replies
                                       ↓
                      (optional) GitHub Markdown sync
```

- Плюси: потенційно безкоштовні квоти для особистого навантаження, без адміністрування Linux.
- Мінуси: потрібно написати логіку Telegram/bot/scheduler та розібратися з конкретними обмеженнями provider.
- Реалістична альтернатива, якщо n8n поки немає де запускати.

## C. GitHub як центральне сховище + статичний сайт

```text
Telegram/backend → GitHub private repo (Markdown + YAML)
                          ↕ (Git sync)
                       Obsidian
                          ↓ (server-side build, carefully scoped)
                 authenticated personal web app
```

- Плюси: читабельні файли, версіонування, один набір даних.
- Мінуси: API/коміти не підходять для частих одночасних записів, конфлікти між мобільним Obsidian і ботом, авторизація приватного сайту складніша за публічну статику.
- GitHub credentials **ніколи** не передавати у браузер.

## Рекомендована стратегія на етапі discovery

1. Вибрати один **source of truth** для capture, бажано durable store; визначити механізм експорту Markdown без подвійних правок.
2. Першим перевірити наскрізний сценарій capture → ранкова рефлексія → persist.
3. Після перевірки користі додати Obsidian Git export/sync.
4. Після стабілізації schema будувати React UI.

## Приватність web app

**Не публікувати приватний vault у публічний build!** Навіть якщо UI має логін, статичні JSON/HTML на CDN можуть бути публічно доступні. Безпечніші варіанти: server-side API з auth, edge access-control для всіх route/assets або повністю локальний застосунок. Конкретний метод вирішити до реалізації.

## Інфраструктура

- Для self-hosted n8n можливий VPS із Docker Compose, reverse proxy, HTTPS, backup, volume, secrets.
- Obsidian як desktop/mobile застосунок не «хоститься» на VPS; сервер може хостити sync-сервіс, як CouchDB, якщо цей варіант вибрано.
- Ціни хостингу, API-можливості та free-tier ліміти перевіряти заново перед купівлею.
- Часова зона для cron має бути явно задана (припущення: `Europe/Prague`), з урахуванням переходів літній/зимовий час.
