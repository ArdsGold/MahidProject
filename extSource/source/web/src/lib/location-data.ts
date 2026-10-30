import { City, Country, State } from "country-state-city";
import type { BusinessProfileInput } from "@backlink-autofill/shared";

export const COUNTRIES = Country.getAllCountries();

export function getStates(countryCode: string) {
  return countryCode ? State.getStatesOfCountry(countryCode) : [];
}

export function getCities(countryCode: string, stateCode: string) {
  return countryCode && stateCode ? City.getCitiesOfState(countryCode, stateCode) : [];
}

export function withCountrySelection(draft: BusinessProfileInput, countryCode: string): BusinessProfileInput {
  const country = Country.getCountryByCode(countryCode);
  return { ...draft, countryCode, country: country?.name ?? "", stateCode: "", state: "", city: "" };
}

export function withStateSelection(draft: BusinessProfileInput, countryCode: string, stateCode: string): BusinessProfileInput {
  const state = State.getStateByCodeAndCountry(stateCode, countryCode);
  return { ...draft, stateCode, state: state?.name ?? "", city: "" };
}

export function withGatheredLocation(draft: BusinessProfileInput, gathered: Partial<BusinessProfileInput>): BusinessProfileInput {
  const country = Country.getAllCountries().find((item) => item.isoCode === gathered.countryCode || item.name.toLowerCase() === gathered.country?.trim().toLowerCase());
  if (!country) return draft;
  const state = State.getStatesOfCountry(country.isoCode).find((item) => item.isoCode === gathered.stateCode || item.isoCode === gathered.state?.trim() || item.name.toLowerCase() === gathered.state?.trim().toLowerCase());
  const city = state ? City.getCitiesOfState(country.isoCode, state.isoCode).find((item) => item.name.toLowerCase() === gathered.city?.trim().toLowerCase()) : undefined;
  return {
    ...draft,
    country: country.name,
    countryCode: country.isoCode,
    state: state?.name ?? "",
    stateCode: state?.isoCode ?? "",
    city: city?.name ?? "",
  };
}
