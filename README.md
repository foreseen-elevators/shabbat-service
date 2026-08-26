# Shabbat Times API

An open-source REST API for Shabbat and Jewish-calendar data: candle-lighting
and havdalah times, the weekly Torah portion (Parashat HaShavua), holiday
context around Shabbat, and the current Hebrew date.

Built on [`@hebcal/core`](https://www.npmjs.com/package/@hebcal/core), the
calculation engine behind [Hebcal](https://www.hebcal.com/).

## Supported cities

`jerusalem`, `tel-aviv`, `haifa`, `beer-sheva`

## Endpoints

All responses are JSON. Base path: `/api`.

### `GET /health`

Liveness check. `{ "status": "ok" }`

### `GET /api/cities`

List of supported city slugs.

### `GET /api/hebrew-date`

The current Hebrew date.

```json
{
  "gregorianDate": "2026-08-03",
  "hebrewDate": {
    "english": "20th of Av, 5786",
    "hebrew": "20 אָב, 5786",
    "gematriya": "כ׳ אב תשפ״ו",
    "year": 5786
  }
}
```

The Hebrew day changes at sunset (in Jerusalem), not midnight, so this
reflects the sunset-aware "today" rather than a plain calendar-midnight day.

### `GET /api/parasha`

The parasha (or holiday reading) for the upcoming Shabbat.

```json
{
  "shabbat": { "hebrewDate": "1st of Elul, 5786", "gregorianDate": "2026-08-15" },
  "isHolidayReading": false,
  "parasha": {
    "english": "Parashat Shoftim",
    "hebrew": "פָּרָשַׁת שׁוֹפְטִים",
    "hebrewNoNikud": "פרשת שופטים",
    "names": ["Shoftim"]
  },
  "holidayReading": null
}
```

### `GET /api/shabbat`

Candle-lighting/havdalah times, parasha, and holiday context for all four
cities in one call. Wraps an array of the same shape as `/api/shabbat/:city`.

### `GET /api/shabbat/:city`

Full detail for one city (`jerusalem`, `tel-aviv`, `haifa`, or `beer-sheva`).

```json
{
  "city": "Jerusalem",
  "citySlug": "jerusalem",
  "timezone": "Asia/Jerusalem",
  "shabbat": { "hebrewDate": "1st of Elul, 5786", "gregorianDate": "2026-08-15" },
  "candleLighting": { "iso": "2026-08-14T15:58:00.000Z", "time": "18:58", "gregorianDate": "2026-08-14" },
  "havdalah": { "iso": "2026-08-15T17:17:00.000Z", "time": "20:17", "gregorianDate": "2026-08-15" },
  "isHolidayReading": false,
  "parasha": {
    "english": "Parashat Shoftim",
    "hebrew": "פָּרָשַׁת שׁוֹפְטִים",
    "hebrewNoNikud": "פרשת שופטים",
    "names": ["Shoftim"]
  },
  "holidayReading": null,
  "chagBeforeShabbat": [],
  "diaspora": { "differsFromIsrael": false, "extraHolidays": [] }
}
```

- **`chagBeforeShabbat`** — any Yom Tov (holiday) day falling on the Thursday
  or Friday immediately before this Shabbat (Israel schedule), e.g. when
  Sukkot leads straight into Shabbat.
- **`diaspora.differsFromIsrael`** — `true` when the Diaspora holiday
  schedule adds an extra Yom Tov day around this Shabbat that Israel does
  not observe (e.g. an eighth day of a festival). `extraHolidays` lists them.

### `?date=YYYY-MM-DD` query parameter

Every endpoint above accepts an optional `date` query parameter to look up a
specific week instead of "now", e.g. `/api/shabbat/haifa?date=2026-12-25`.

### `GET /api/melacha-windows`

Every span of time during which melacha (work) is forbidden - Shabbat *and*
any standalone Yom Tov day, whether or not it's adjacent to a Saturday (e.g.
a midweek day of Rosh Hashana) - over the next `days` days (default `60`,
max `180`), for Jerusalem. Intended for callers who want to cache this once
(it changes rarely) and evaluate "is it forbidden right now" locally
instead of asking on every check.

- `?reckoning=israel|diaspora` (default `israel`) - `diaspora` uses the
  Diaspora holiday schedule, which adds the extra "Yom Tov Sheni shel
  Galuyot" day (e.g. Sukkot II, Simchat Torah as a day separate from Shmini
  Atzeret).
- `?date=YYYY-MM-DD` - scan starting from this date instead of now.

```json
{
  "reckoning": "israel",
  "generatedAt": "2026-08-26T10:00:00.000Z",
  "windows": [
    {
      "start": "2026-08-28T16:08:00.000Z",
      "end": "2026-08-29T16:44:00.000Z",
      "reasons": ["Shabbat"]
    },
    {
      "start": "2026-09-20T15:39:00.000Z",
      "end": "2026-09-21T16:13:00.000Z",
      "reasons": ["Yom Kippur"]
    }
  ]
}
```

`reasons` is informational only (not used for the boolean check itself).

## Running locally

```bash
npm install
npm run dev      # ts-node/tsx dev server with reload
# or
npm run build && npm start
```

Configuration is via environment variables (see `.env.example`):

| Variable                | Default | Description                                    |
| ------------------------ | ------- | ----------------------------------------------- |
| `PORT`                  | `3000`  | HTTP port                                        |
| `RATE_LIMIT_PER_MINUTE` | `20`    | Requests allowed per IP per 60-second window     |
| `TRUST_PROXY`           | `1`     | Express `trust proxy` hops (keep `1` behind Coolify/Traefik) |

## Rate limiting

To keep this a good public citizen, every client IP is limited to
**20 requests per minute** (`express-rate-limit`, configurable via
`RATE_LIMIT_PER_MINUTE`). Requests over the limit get `HTTP 429`.

## Deploying on Coolify

1. Push this repo to GitHub/GitLab.
2. In Coolify, create a new **Application** resource pointing at the repo.
3. Coolify will detect and build the included `Dockerfile`.
4. Set `PORT=3000` (or leave the default) and expose port `3000`.
5. Deploy.

## License

GPL-2.0, matching `@hebcal/core`'s license exactly (see [`LICENSE`](./LICENSE)).

This project is not affiliated with or endorsed by Hebcal.
