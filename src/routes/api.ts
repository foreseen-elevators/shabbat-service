import { Router, type Request } from 'express';
import { CITY_SLUGS, isCitySlug } from '../cities.js';
import {
  getHebrewDateToday,
  getNextParasha,
  getNextShabbatForAllCities,
  getNextShabbatForCity,
} from '../hebcalService.js';

export const apiRouter = Router();

class BadRequestError extends Error {}

/**
 * Optional `?date=YYYY-MM-DD` query param lets callers ask "what does Shabbat
 * look like for the week containing this date" instead of always "now".
 * Returns `undefined` when absent so each service function can apply its own
 * appropriate default rather than us guessing "now" here.
 */
function parseReferenceDate(req: Request): Date | undefined {
  const raw = req.query.date;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new BadRequestError('"date" must be a single YYYY-MM-DD value');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`"date" is not a valid date: ${raw}`);
  return parsed;
}

apiRouter.get('/cities', (_req, res) => {
  res.json({ cities: CITY_SLUGS });
});

apiRouter.get('/hebrew-date', (req, res, next) => {
  try {
    res.json(getHebrewDateToday(parseReferenceDate(req)));
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/parasha', (req, res, next) => {
  try {
    res.json(getNextParasha(parseReferenceDate(req)));
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/shabbat', (req, res, next) => {
  try {
    res.json({ cities: getNextShabbatForAllCities(parseReferenceDate(req)) });
  } catch (err) {
    next(err);
  }
});

apiRouter.get('/shabbat/:city', (req, res, next) => {
  try {
    const { city } = req.params;
    if (!isCitySlug(city)) {
      res.status(404).json({ error: `Unknown city "${city}"`, supportedCities: CITY_SLUGS });
      return;
    }
    res.json(getNextShabbatForCity(city, parseReferenceDate(req)));
  } catch (err) {
    next(err);
  }
});

apiRouter.use(
  (err: unknown, _req: Request, res: import('express').Response, _next: import('express').NextFunction) => {
    if (err instanceof BadRequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  },
);
