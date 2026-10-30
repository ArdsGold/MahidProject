import type { BusinessInternalLink, BusinessProfileInput } from "./business-profile.ts";

export type SourceCaptureType = "website" | "gmb";

export interface SourceSnapshot {
  sourceType: SourceCaptureType;
  sourceUrl: string;
  capturedAt: string;
  facts: Partial<BusinessProfileInput>;
  internalLinks: BusinessInternalLink[];
  evidence?: {
    title?: string;
    visibleTextLength?: number;
    structuredData?: boolean;
  };
}

const GENERIC_NAMES = /^(google(?: maps)?|maps|google business profile|untitled|home|welcome|menu|navigation)$/i;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => Boolean(stringValue(item))).map((item) => item.trim()))].slice(0, max);
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function comparableOrigin(url: URL): string {
  return `${url.protocol}//${url.hostname.toLowerCase().replace(/^www\./, "")}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
}

function normalizeFacts(value: unknown): Partial<BusinessProfileInput> {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const facts: Partial<BusinessProfileInput> = {};
  const fields = ["businessName", "contactName", "email", "phone", "website", "address", "city", "state", "postalCode", "country", "countryCode", "stateCode", "description", "shortDescription", "category", "facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest"] as const;
  for (const field of fields) {
    const item = stringValue(raw[field]);
    if (item) facts[field] = item;
  }
  const services = stringArray(raw.services, 10);
  const businessHours = stringArray(raw.businessHours, 14);
  if (services.length) facts.services = services;
  if (businessHours.length) facts.businessHours = businessHours;
  if (facts.businessName && GENERIC_NAMES.test(facts.businessName)) delete facts.businessName;
  if (facts.category && GENERIC_NAMES.test(facts.category)) delete facts.category;
  return facts;
}

export function normalizeSourceSnapshot(value: unknown): SourceSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const sourceType = raw.sourceType === "website" || raw.sourceType === "gmb" ? raw.sourceType : null;
  if (!sourceType || !validHttpUrl(raw.sourceUrl) || typeof raw.capturedAt !== "string") return null;
  const base = new URL(raw.sourceUrl);
  const internalLinks = Array.isArray(raw.internalLinks) ? raw.internalLinks.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const entry = item as Record<string, unknown>;
    const label = stringValue(entry.label);
    if (!label || !validHttpUrl(entry.url)) return [];
    const url = new URL(entry.url);
    url.hash = "";
    if (comparableOrigin(url) !== comparableOrigin(base)) return [];
    return [{ label: label.slice(0, 120), url: url.href.replace(/\/$/, "") || url.origin, type: entry.type === "commercial" ? "commercial" : "fallback" } satisfies BusinessInternalLink];
  }).slice(0, 12) : [];
  return {
    sourceType,
    sourceUrl: raw.sourceUrl,
    capturedAt: raw.capturedAt,
    facts: normalizeFacts(raw.facts),
    internalLinks: [...new Map(internalLinks.map((link) => [link.url, link])).values()].slice(0, 12),
    evidence: typeof raw.evidence === "object" && raw.evidence !== null ? {
      title: stringValue((raw.evidence as Record<string, unknown>).title),
      visibleTextLength: typeof (raw.evidence as Record<string, unknown>).visibleTextLength === "number" ? Number((raw.evidence as Record<string, unknown>).visibleTextLength) : undefined,
      structuredData: (raw.evidence as Record<string, unknown>).structuredData === true,
    } : undefined,
  };
}
