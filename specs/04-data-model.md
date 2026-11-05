# 04. Data model (draft)

## Сутності

- **MediaItem:** об'єкт контенту; канонічна URL або вручну введена назва; type; title; creator; artwork; metadata; timestamps.
- **Capture:** подія надсилання в Telegram із сирим повідомленням, origin, часовою позначкою; можлива повторна capture одного MediaItem.
- **Reflection:** власні враження про MediaItem, позитивне/негативне, оцінка (опційно), дата; може бути кілька в різні моменти.
- **PromptState:** коли надіслано рефлексивне питання, status `pending`, `snoozed`, `skipped`, `answered`; уникати повторів.
- **AIEnrichment:** машинно створені метадані/підсумок/класифікація з позначенням джерела й помилок, не змішувати з власним відгуком.

## Типи

`video`, `music_track`, `music_album`, `game`, `article`, `social_post`, `book`, `other`.

## Lifecycle

- `saved`: збережено, не обов'язково спожито.
- `consumed`: переглянуто, прослухано, пройдено або прочитано.
- `reviewed`: додано власне враження; rating необов'язковий.

Для великих ігор/книг знадобляться проміжні стани `in_progress` / `completed`; до MVP не обов'язкові. Слід відокремлювати status споживання від prompt-state.

## Приклад Markdown (ілюстративні, вигадані дані)

```markdown
---
id: media_01JEXAMPLE
schema_version: 1
type: music_album
source: spotify
url: https://open.spotify.com/album/example
title: Example Album
creator: Example Artist
status: reviewed
captured_at: 2026-11-03T21:00:00+01:00
consumed_at: 2026-11-03
reviewed_at: 2026-11-04
rating: 8
tags:
  - electronic
  - atmospheric
---

# Example Album

## Мої враження

Подобається глибокий бас і простір у звучанні.

## Не сподобалося

Декілька треків надто подібні між собою.

## Зміни враження

- 2026-11-04: Перша оцінка 8/10.
```

## Правила

- Унікальний, незмінний id не залежить від title/path.
- Зберігати timestamp з offset або в UTC; відображення локалізувати.
- URL нормалізувати обережно: видаляти очевидні tracking parameters, не ламати ідентифікатори.
- Підтримати null/no rating, а не трактувати порожнє як нуль.
- AI-generated description зберігати окремо від відгуку користувача.
- Не робити 1 файл = 1 capture, якщо багато повторних взаємодій належать до одного медіа.
- Визначити стабільний шлях у vault (наприклад `Media/<type>/<id>.md`) після вибору schema.

## Реалізована схема (v3)

Draft вище — історичний; актуальна схема:

- `items`: id, url (UNIQUE, без tracking-параметрів), title, type, created_at, `details` JSON — source, creator, status (saved / in_progress / consumed / finished; null у ресурсу), consumed_on + date_source (capture / user), reaction (positive / mixed / negative / null), tags, entities, summary (AI), description / site / image_url / cover / photo_file_id (зі сторінки), manual_fields (AI не чіпає), metadata_fields (назва/автор зі сторінки), metadata_loaded, ai_done, snooze_until.
- `captures` і `reflections` — по одному рядку на Telegram update; багато на один item.
- `enrichment` — сирі AI-відповіді за update, окремо від власних вражень.
- `prompts` — повідомлення бота → item (для Reply) і стан рефлексії (pending / answered / skipped).
- `events` — історія ручних змін status / reaction / type: item_id, field, old, new, at. Для аналітики (скільки чекало в «На потім», як змінювалась оцінка). Видаляється разом із записом. Зміни до 2026-11-05 не збереглися.
- Службові: `updates`, `context`, `update_context` (маршрут незавершеного update), `vault_exports` / `vault_pending` (manifest експорту). У JSON snapshot не потрапляють; для повного backup потрібна SQLite і `data/covers/`.

`PRAGMA user_version=3`. JSON snapshot має `schema_version: 3`.
