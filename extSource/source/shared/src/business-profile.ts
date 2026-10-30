export interface ProfileAssetRef {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface BusinessInternalLink {
  label: string;
  url: string;
  type: "commercial" | "fallback";
}

export type SocialPlatform = "facebook" | "instagram" | "linkedin" | "twitter" | "youtube" | "tiktok" | "pinterest" | "other";

export interface BusinessSocialLink {
  url: string;
  platform: SocialPlatform;
}

export interface BusinessProfile {
  id: string;
  businessName: string;
  firstName: string;
  lastName: string;
  contactName: string;
  username: string;
  email: string;
  password: string;
  phone: string;
  website: string;
  imageUrl: string;
  address: string;
  completeAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  countryCode?: string;
  stateCode?: string;
  description: string;
  shortDescription: string;
  category: string;
  services: string[];
  facebook: string;
  instagram: string;
  linkedin: string;
  twitter: string;
  youtube: string;
  tiktok: string;
  pinterest: string;
  socialLinks: BusinessSocialLink[];
  businessHours: string[];
  /** @deprecated Kept for local-profile migration; new uploads use logoAsset. */
  logoUrl: string;
  /** @deprecated Kept for local-profile migration; new uploads use brochureAsset. */
  brochureUrl: string;
  logoAsset?: ProfileAssetRef;
  brochureAsset?: ProfileAssetRef;
  sourceGmbUrl?: string;
  sourceWebsiteUrl?: string;
  internalLinks: BusinessInternalLink[];
  createdAt: string;
  updatedAt: string;
}

export type BusinessProfileInput = Omit<BusinessProfile, "id" | "createdAt" | "updatedAt">;

export type BusinessProfileField = keyof BusinessProfileInput;

export const AUTOFILL_FIELDS = [
  "businessName",
  "firstName",
  "lastName",
  "contactName",
  "username",
  "email",
  "password",
  "phone",
  "website",
] as const;

export type AutofillField = (typeof AUTOFILL_FIELDS)[number];

export function createEmptyProfileInput(): BusinessProfileInput {
  return {
    businessName: "",
    firstName: "",
    lastName: "",
    contactName: "",
    username: "",
    email: "",
    password: "",
    phone: "",
    website: "",
    imageUrl: "",
    address: "",
    completeAddress: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    countryCode: "",
    stateCode: "",
    description: "",
    shortDescription: "",
    category: "",
    services: [],
    facebook: "",
    instagram: "",
    linkedin: "",
    twitter: "",
    youtube: "",
    tiktok: "",
    pinterest: "",
    socialLinks: [],
    businessHours: [],
    logoUrl: "",
    brochureUrl: "",
    logoAsset: undefined,
    brochureAsset: undefined,
    sourceGmbUrl: "",
    sourceWebsiteUrl: "",
    internalLinks: [],
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asAssetRef(value: unknown): ProfileAssetRef | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.fileName !== "string" ||
    typeof raw.mimeType !== "string" ||
    typeof raw.size !== "number"
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    fileName: raw.fileName,
    mimeType: raw.mimeType,
    size: raw.size,
  };
}

function asInternalLinks(value: unknown): BusinessInternalLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const raw = entry as Record<string, unknown>;
    if (
      typeof raw.label !== "string" ||
      typeof raw.url !== "string" ||
      (raw.type !== "commercial" && raw.type !== "fallback")
    ) return [];
    return [{ label: raw.label, url: raw.url, type: raw.type }];
  });
}

function asSocialLinks(value: unknown): BusinessSocialLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const raw = entry as Record<string, unknown>;
    const platform = raw.platform;
    if (typeof raw.url !== "string" || !raw.url.trim() || typeof platform !== "string" || !["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest", "other"].includes(platform)) return [];
    return [{ url: raw.url, platform: platform as SocialPlatform }];
  });
}

function mergeSocialLinks(raw: Record<string, unknown>): BusinessSocialLink[] {
  const links = asSocialLinks(raw.socialLinks);
  const known = ["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest"] as const;
  for (const platform of known) {
    const url = asString(raw[platform]);
    if (url && !links.some((link) => link.url === url)) links.push({ url, platform });
  }
  return links;
}

export function deriveNameParts(businessName: string): { firstName: string; lastName: string } {
  const words = businessName.trim().split(/\s+/).filter(Boolean);
  return { firstName: words[0] || "", lastName: words[words.length - 1] || "" };
}

export function formatBusinessAddress(address: string, city: string, state: string, stateCode: string | undefined, postalCode: string, country: string): string {
  const base = address.trim();
  const normalizedBase = base.toLowerCase();
  const known = [city, stateCode || state, postalCode, country].filter(Boolean).map((part) => part.trim().toLowerCase());
  if (base && known.every((part) => normalizedBase.includes(part))) return base;
  const region = [stateCode || state, postalCode].map((part) => part.trim()).filter(Boolean).join(" ");
  return [base, city, region, country].map((part) => part.trim()).filter(Boolean).filter((part, index, parts) => index === 0 || parts.slice(0, index).every((previous) => previous.toLowerCase() !== part.toLowerCase())).join(", ");
}

export function splitBusinessAddress(address: string): { street: string; city: string; state: string; postalCode: string; country: string } | null {
  const parsed = address.trim().match(/^(.+?),\s*([^,]+),\s*([A-Za-z]{2}|[A-Za-z][A-Za-z .'-]+?)\s+(\d{5}(?:-\d{4})?),\s*(.+)$/);
  return parsed ? { street: parsed[1].trim(), city: parsed[2].trim(), state: parsed[3].trim(), postalCode: parsed[4].trim(), country: parsed[5].trim() } : null;
}

/**
 * Validates and normalizes an unknown payload into a BusinessProfile.
 * Used by the extension transport so autofill never runs on malformed data.
 */
export function normalizeBusinessProfile(value: unknown): BusinessProfile | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return null;
  }
  const rawCity = asString(raw.city);
  const rawState = asString(raw.state);
  const rawStateCode = asString(raw.stateCode);
  const rawPostalCode = asString(raw.postalCode);
  const rawCountry = asString(raw.country);
  const rawAddress = asString(raw.address);
  const rawCompleteAddress = asString(raw.completeAddress);
  const migratedParts = !rawCompleteAddress ? splitBusinessAddress(rawAddress) : null;
  const streetAddress = migratedParts ? migratedParts.street : rawAddress;
  const completeAddress = rawCompleteAddress || formatBusinessAddress(rawAddress, rawCity || migratedParts?.city || "", rawState || migratedParts?.state || "", rawStateCode, rawPostalCode || migratedParts?.postalCode || "", rawCountry || migratedParts?.country || "");
  const normalized: BusinessProfile = {
    id: raw.id,
    businessName: asString(raw.businessName),
    firstName: asString(raw.firstName) || deriveNameParts(asString(raw.businessName)).firstName,
    lastName: asString(raw.lastName) || deriveNameParts(asString(raw.businessName)).lastName,
    contactName: asString(raw.contactName),
    username: asString(raw.username),
    email: asString(raw.email),
    password: asString(raw.password),
    phone: asString(raw.phone),
    website: asString(raw.website),
    imageUrl: asString(raw.imageUrl),
    address: streetAddress,
    completeAddress,
    city: rawCity || migratedParts?.city || "",
    state: rawState || migratedParts?.state || "",
    postalCode: rawPostalCode || migratedParts?.postalCode || "",
    country: rawCountry || migratedParts?.country || "",
    countryCode: asString(raw.countryCode),
    stateCode: rawStateCode,
    description: asString(raw.description),
    shortDescription: asString(raw.shortDescription),
    category: asString(raw.category),
    services: asStringArray(raw.services),
    facebook: asString(raw.facebook),
    instagram: asString(raw.instagram),
    linkedin: asString(raw.linkedin),
    twitter: asString(raw.twitter),
    youtube: asString(raw.youtube),
    tiktok: asString(raw.tiktok),
    pinterest: asString(raw.pinterest),
    socialLinks: mergeSocialLinks(raw),
    businessHours: asStringArray(raw.businessHours),
    logoUrl: asString(raw.logoUrl),
    brochureUrl: asString(raw.brochureUrl),
    logoAsset: asAssetRef(raw.logoAsset),
    brochureAsset: asAssetRef(raw.brochureAsset),
    sourceGmbUrl: asString(raw.sourceGmbUrl),
    sourceWebsiteUrl: asString(raw.sourceWebsiteUrl),
    internalLinks: asInternalLinks(raw.internalLinks),
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
  };
  return normalized;
}
