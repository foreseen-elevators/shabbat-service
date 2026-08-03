import { Location } from '@hebcal/core';

export type CitySlug = 'jerusalem' | 'tel-aviv' | 'haifa' | 'beer-sheva';

export const CITY_LOOKUP_NAME: Record<CitySlug, string> = {
  jerusalem: 'Jerusalem',
  'tel-aviv': 'Tel Aviv',
  haifa: 'Haifa',
  'beer-sheva': 'Beer Sheva',
};

export const CITY_SLUGS = Object.keys(CITY_LOOKUP_NAME) as CitySlug[];

export function isCitySlug(value: string): value is CitySlug {
  return Object.prototype.hasOwnProperty.call(CITY_LOOKUP_NAME, value);
}

export function getLocationForCity(city: CitySlug): Location {
  const location = Location.lookup(CITY_LOOKUP_NAME[city]);
  if (!location) {
    // Only reachable if @hebcal/core drops one of these built-in cities in a future release.
    throw new Error(`No @hebcal/core location found for city "${city}"`);
  }
  return location;
}
