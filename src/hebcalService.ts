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
