import {
  CandleLightingEvent,
  Event,
  HDate,
  HavdalahEvent,
  HebrewCalendar,
  Location,
  ParshaEvent,
  Zmanim,
  flags,
  isAssurBemlacha,
} from '@hebcal/core';
import { CITY_LOOKUP_NAME, CITY_SLUGS, CitySlug, getLocationForCity } from './cities.js';

const SEARCH_WINDOW_DAYS = 10;
const ISRAEL_TZ = 'Asia/Jerusalem';
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface TimeInfo {
  iso: string;
  time: string;
  gregorianDate: string;
}

interface HolidayInfo {
  english: string;
  hebrew: string;
  desc: string;
}

/**
 * Formats a Date's calendar-day fields as "YYYY-MM-DD" using its *local*
 * getters, never `toISOString()`. Dates coming from `HDate.greg()` encode a
 * calendar day via local-midnight semantics (tied to the process's system
 * timezone); reading them back through UTC-based `toISOString()` can shift
 * the day by one depending on that timezone. Local getters round-trip
 * correctly regardless of what the system timezone actually is.
 */
function formatYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True day-of-week (0=Sun..6=Sat) for an instant, in Israel local time, independent of host system timezone. */
function israelWeekday(date: Date): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: ISRAEL_TZ, weekday: 'short' }).format(date);
  return WEEKDAY_INDEX[label];
}

/** "YYYY-MM-DD" for an instant's calendar day in Israel local time, independent of host system timezone. */
function israelYMD(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ISRAEL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function toTimeInfo(ev: CandleLightingEvent | HavdalahEvent): TimeInfo {
  return {
    iso: ev.eventTime.toISOString(),
    time: ev.eventTimeStr,
    gregorianDate: formatYMD(ev.getDate().greg()),
  };
}

function describeHoliday(ev: Event): HolidayInfo {
  return { english: ev.render('en'), hebrew: ev.render('he'), desc: ev.getDesc() };
}

function getChagFlaggedHolidays(hdate: HDate, il: boolean): Event[] {
  const events = HebrewCalendar.getHolidaysOnDate(hdate, il) ?? [];
  return events.filter((ev) => (ev.getFlags() & flags.CHAG) !== 0);
}

interface UpcomingShabbat {
  candleLighting: CandleLightingEvent;
  havdalah: HavdalahEvent | null;
  shabbatHDate: HDate;
}

/**
 * Resolves the next (or currently in-progress, if `referenceDate` falls on a
 * Saturday) Shabbat: its Friday candle-lighting event, the timed event that
 * closes it out (Havdalah, or a Yom-Tov candle-lighting if a holiday follows
 * directly), and the Saturday's HDate.
 */
function resolveUpcomingShabbat(referenceDate: Date, location: Location): UpcomingShabbat {
  const end = new Date(referenceDate.getTime() + SEARCH_WINDOW_DAYS * 24 * 3600 * 1000);
  const events = HebrewCalendar.calendar({
    start: referenceDate,
    end,
    candlelighting: true,
    location,
    il: true,
    sedrot: true,
  });

  const candleLighting = events.find(
    (ev): ev is CandleLightingEvent =>
      ev instanceof CandleLightingEvent &&
      ev.eventTime.getTime() >= referenceDate.getTime() &&
      israelWeekday(ev.eventTime) === 5,
  );

  if (!candleLighting) {
    throw new Error(`Could not find an upcoming Friday candle-lighting within ${SEARCH_WINDOW_DAYS} days`);
  }

  const startIdx = events.indexOf(candleLighting);
  const havdalah =
    events.slice(startIdx + 1).find((ev): ev is HavdalahEvent => ev instanceof HavdalahEvent) ?? null;

  const fridayGreg = candleLighting.getDate().greg();
  const saturdayGreg = new Date(fridayGreg.getTime() + 24 * 3600 * 1000);
  const shabbatHDate = new HDate(saturdayGreg);

  return { candleLighting, havdalah, shabbatHDate };
}

function resolveParasha(shabbatHDate: HDate, il: boolean) {
  const sedra = HebrewCalendar.getSedra(shabbatHDate.getFullYear(), il);
  const result = sedra.lookup(shabbatHDate);

  if (!result.chag) {
    const parshaEvent = new ParshaEvent(result);
    return {
      isHolidayReading: false as const,
      parasha: {
        english: parshaEvent.render('en'),
        hebrew: parshaEvent.render('he'),
        hebrewNoNikud: parshaEvent.render('he-x-NoNikud'),
        names: result.parsha,
      },
      holidayReading: null,
    };
  }

  const holidayEvents = HebrewCalendar.getHolidaysOnDate(shabbatHDate, il) ?? [];
  return {
    isHolidayReading: true as const,
    parasha: null,
    holidayReading: holidayEvents.map(describeHoliday),
  };
}

/**
 * Looks at the Thursday/Friday/Saturday/Sunday around a Shabbat to report:
 * - `chagBeforeShabbat`: any Yom Tov day immediately preceding Shabbat (Israel schedule)
 * - `diaspora`: any extra Yom Tov day that only exists in the Diaspora schedule
 *   that week (e.g. a second day of Yom Tov attached to this Shabbat)
 */
function resolveChagContext(candleLighting: CandleLightingEvent) {
  const fridayHDate = candleLighting.getDate();
  const thursdayHDate = new HDate(fridayHDate.abs() - 1);
  const saturdayHDate = new HDate(fridayHDate.abs() + 1);
  const sundayHDate = new HDate(fridayHDate.abs() + 2);
  const surroundingDates = [thursdayHDate, fridayHDate, saturdayHDate, sundayHDate];

  const chagBeforeShabbat = [thursdayHDate, fridayHDate]
    .flatMap((hd) => getChagFlaggedHolidays(hd, true))
    .map(describeHoliday);

  const israelChag = surroundingDates.flatMap((hd) => getChagFlaggedHolidays(hd, true));
  const diasporaChag = surroundingDates.flatMap((hd) => getChagFlaggedHolidays(hd, false));

  const israelKeys = new Set(israelChag.map((ev) => `${ev.getDate().toString()}|${ev.getDesc()}`));
  const extraInDiaspora = diasporaChag
    .filter((ev) => !israelKeys.has(`${ev.getDate().toString()}|${ev.getDesc()}`))
    .map(describeHoliday);

  return {
    chagBeforeShabbat,
    diaspora: {
      differsFromIsrael: extraInDiaspora.length > 0,
      extraHolidays: extraInDiaspora,
    },
  };
}

export function getNextShabbatForCity(city: CitySlug, referenceDate: Date = new Date()) {
  const location = getLocationForCity(city);
  const { candleLighting, havdalah, shabbatHDate } = resolveUpcomingShabbat(referenceDate, location);
  const parashaInfo = resolveParasha(shabbatHDate, true);
  const chagContext = resolveChagContext(candleLighting);

  return {
    city: CITY_LOOKUP_NAME[city],
    citySlug: city,
    timezone: location.getTzid(),
    shabbat: {
      hebrewDate: shabbatHDate.render('en'),
      gregorianDate: formatYMD(shabbatHDate.greg()),
    },
    candleLighting: toTimeInfo(candleLighting),
    havdalah: havdalah ? toTimeInfo(havdalah) : null,
    ...parashaInfo,
    chagBeforeShabbat: chagContext.chagBeforeShabbat,
    diaspora: chagContext.diaspora,
  };
}

export function getNextShabbatForAllCities(referenceDate: Date = new Date()) {
  return CITY_SLUGS.map((city) => getNextShabbatForCity(city, referenceDate));
}

export function getNextParasha(referenceDate: Date = new Date()) {
  // Parasha and Shabbat date don't depend on the city; Jerusalem is used only
  // as a reference location to walk the calendar forward.
  const location = getLocationForCity('jerusalem');
  const { shabbatHDate } = resolveUpcomingShabbat(referenceDate, location);
  return {
    shabbat: {
      hebrewDate: shabbatHDate.render('en'),
      gregorianDate: formatYMD(shabbatHDate.greg()),
    },
    ...resolveParasha(shabbatHDate, true),
  };
}

export function getHebrewDateToday(referenceDate?: Date) {
  const effectiveDate = referenceDate ?? new Date();
  // The Hebrew day changes at sunset, not midnight - Jerusalem is used as
  // the reference location regardless of which city a caller cares about.
  const location = getLocationForCity('jerusalem');
  const hd = Zmanim.makeSunsetAwareHDate(location, effectiveDate, false);
  return {
    gregorianDate: israelYMD(effectiveDate),
    hebrewDate: {
      english: hd.render('en'),
      hebrew: hd.render('he'),
      gematriya: hd.renderGematriya(true),
      year: hd.getFullYear(),
    },
  };
}

// --- Melacha (work-forbidden) windows -------------------------------------
//
// This section answers a different question than the rest of the file: not
// "what does the upcoming Shabbat look like", but "during which spans of
// time is melacha (work) forbidden at all" - Shabbat *and* every standalone
// Yom Tov day, whether or not it happens to sit next to a Saturday (e.g. day
// 1 of Rosh Hashana on a Tuesday). Consumers cache this and evaluate
// "is it forbidden right now" locally, without needing @hebcal/core
// themselves.

export type Reckoning = 'israel' | 'diaspora';

export interface MelachaWindow {
  /** ISO instant melacha becomes forbidden (real halachic sunset, not a candle-lighting custom). */
  start: string;
  /** ISO instant melacha becomes permitted again (real halachic nightfall/tzeit). */
  end: string;
  /** Human-readable labels ("Shabbat", holiday names) covering the window - informational only. */
  reasons: string[];
}

const JERUSALEM_ISRAEL_RECKONING = getLocationForCity('jerusalem');

// Same place and zmanim as Jerusalem, but flagged as Diaspora (il: false), so
// isAssurBemlacha uses the Diaspora holiday calendar - adding the extra
// "Yom Tov Sheni shel Galuyot" day some callers need (e.g. Sukkot II,
// Simchat Torah) that Israel itself does not observe.
//
// IMPORTANT: countryCode is deliberately omitted (not JERUSALEM's 'IL').
// @hebcal/core's Location constructor force-overrides `il` back to `true`
// whenever countryCode === 'IL', silently ignoring the explicit `il: false`
// passed as the 3rd argument. Passing 'IL' here would make this location
// behave exactly like JERUSALEM_ISRAEL_RECKONING - which is what the old
// hebcalShabbat.js in first-http-node-coolify did, so its Diaspora path
// never actually differed from Israel's in production.
const JERUSALEM_DIASPORA_RECKONING = new Location(
  JERUSALEM_ISRAEL_RECKONING.getLatitude(),
  JERUSALEM_ISRAEL_RECKONING.getLongitude(),
  false,
  JERUSALEM_ISRAEL_RECKONING.getTzid(),
  'Jerusalem (Diaspora reckoning)',
  undefined,
  undefined,
  JERUSALEM_ISRAEL_RECKONING.getElevation(),
);

function getReckoningLocation(reckoning: Reckoning): Location {
  return reckoning === 'diaspora' ? JERUSALEM_DIASPORA_RECKONING : JERUSALEM_ISRAEL_RECKONING;
}

// `false` here means "use the real halachic sunset/nightfall boundary, not a
// candle-lighting custom offset" - matches how @hebcal/core's own docs
// describe this parameter.
function isForbidden(date: Date, location: Location): boolean {
  return isAssurBemlacha(date, location, false);
}

const COARSE_STEP_MS = 15 * 60 * 1000;
const REFINE_STEP_MS = 60 * 1000;
// Windows can start before the requested range (e.g. we're mid-Shabbat when
// asked); scan back this far first so a window's true start is reported
// rather than clipped to the request time. Longer than any real Shabbat/chag
// span (even Rosh Hashana + adjoining Shabbat is under 4 days).
const LOOKBACK_DAYS = 5;

/**
 * Binary-searches the transition between two adjacent coarse samples down to
 * minute precision. `loTime` and `hiTime` are known to have different
 * `isForbidden` states.
 */
function refineTransition(loTime: number, hiTime: number, location: Location): number {
  const loState = isForbidden(new Date(loTime), location);
  let lo = loTime;
  let hi = hiTime;
  while (hi - lo > REFINE_STEP_MS) {
    const mid = lo + Math.round((hi - lo) / 2 / REFINE_STEP_MS) * REFINE_STEP_MS;
    if (isForbidden(new Date(mid), location) === loState) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return hi;
}

/** Labels describing why melacha is forbidden across every Israel-local calendar day the window touches. */
function describeWindow(startMs: number, endMs: number, il: boolean): string[] {
  const reasons = new Set<string>();
  for (let cursor = startMs; cursor <= endMs; cursor += 24 * 3600 * 1000) {
    const cursorDate = new Date(cursor);
    if (israelWeekday(cursorDate) === 6) reasons.add('Shabbat');
    const holidays = HebrewCalendar.getHolidaysOnDate(new HDate(cursorDate), il) ?? [];
    holidays
      .filter((ev) => (ev.getFlags() & flags.CHAG) !== 0)
      .forEach((ev) => reasons.add(ev.render('en')));
  }
  return Array.from(reasons);
}

/**
 * Scans forward from `referenceDate` (looking back `LOOKBACK_DAYS` first, in
 * case a window is already in progress) for `days` days, returning every
 * contiguous melacha-forbidden window found. Coarse-samples every 15 minutes
 * (cheap, and no real Shabbat/chag boundary needs finer resolution to
 * *detect*), then binary-searches each detected transition down to the
 * minute - the precision candle-lighting/havdalah times are themselves given in.
 */
export function getMelachaWindows(
  reckoning: Reckoning,
  days: number,
  referenceDate: Date = new Date(),
): MelachaWindow[] {
  const location = getReckoningLocation(reckoning);
  const il = reckoning === 'israel';
  const scanStart = referenceDate.getTime() - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const scanEnd = referenceDate.getTime() + days * 24 * 3600 * 1000;

  const referenceMs = referenceDate.getTime();
  const windows: MelachaWindow[] = [];
  let windowStartMs: number | null = null;
  let prevTime = scanStart;
  let prevState = isForbidden(new Date(prevTime), location);
  if (prevState) windowStartMs = prevTime;

  for (let t = scanStart + COARSE_STEP_MS; t <= scanEnd; t += COARSE_STEP_MS) {
    const state = isForbidden(new Date(t), location);
    if (state !== prevState) {
      const boundary = refineTransition(prevTime, t, location);
      if (state) {
        windowStartMs = boundary;
      } else if (windowStartMs !== null) {
        windows.push({
          start: new Date(windowStartMs).toISOString(),
          end: new Date(boundary).toISOString(),
          reasons: describeWindow(windowStartMs, boundary, il),
        });
        windowStartMs = null;
      }
    }
    prevTime = t;
    prevState = state;
  }

  // Still inside a window at the end of the scanned range - report it
  // truncated at scanEnd; the next daily refresh will pick up its real end.
  if (windowStartMs !== null) {
    windows.push({
      start: new Date(windowStartMs).toISOString(),
      end: new Date(scanEnd).toISOString(),
      reasons: describeWindow(windowStartMs, scanEnd, il),
    });
  }

  // The lookback exists only to recover the true start of a window that's
  // already in progress at referenceDate; a window that fully concluded
  // before referenceDate is stale leftover from that lookback and (being
  // clipped to scanStart rather than its real start) would report a
  // misleading `start` anyway, so drop it.
  return windows.filter((w) => new Date(w.end).getTime() >= referenceMs);
}
