import { normalizeSourceSnapshot } from "../../../shared/src/source-capture.ts";
import type { BusinessProfileInput } from "@backlink-autofill/shared";

export function generateBrowserShortDescription(facts: Partial<BusinessProfileInput>): string {
  const name = facts.businessName?.trim();
  if (!name) return "";
  const source = facts.description?.trim().split(/(?<=[.!?])\s+/)[0] || "";
  if (source.length <= 160) return source;
  const detail = facts.category?.trim() || facts.services?.[0]?.trim() || "";
  const compact = detail ? `${name} provides ${detail.toLowerCase()}.` : `${name}.`;
  return compact.length <= 160 ? compact : "";
}

export function mergeBrowserSourceIntoDraft(draft: BusinessProfileInput, rawSnapshot: unknown): BusinessProfileInput | null {
  const snapshot = normalizeSourceSnapshot(rawSnapshot);
  if (!snapshot) return null;
  const facts = snapshot.facts;
  const next = { ...draft };
  const core = ["businessName", "phone", "address", "city", "state", "postalCode", "country", "countryCode", "stateCode", "category"] as const;
  const detail = ["website", "description", "facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest"] as const;
  if (snapshot.sourceType === "gmb") for (const key of core) if (facts[key]) next[key] = facts[key] as never;
  if (snapshot.sourceType === "website") for (const key of core) if (!next[key] && facts[key]) next[key] = facts[key] as never;
  for (const key of detail) if (facts[key]) next[key] = facts[key] as never;
  if (facts.services?.length && (snapshot.sourceType === "website" || !next.services.length)) next.services = facts.services;
  if (facts.businessHours?.length && (snapshot.sourceType === "gmb" || !next.businessHours.length)) next.businessHours = facts.businessHours;
  if (snapshot.sourceType === "website" && snapshot.internalLinks.length) next.internalLinks = snapshot.internalLinks;
  const shortDescription = generateBrowserShortDescription({ ...next, ...facts });
  if (shortDescription) next.shortDescription = shortDescription;
  return next;
}
