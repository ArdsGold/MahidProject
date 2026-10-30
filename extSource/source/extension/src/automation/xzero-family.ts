import type { AdaptiveStage } from "./adaptive-discovery";

export interface XZeroFamilyMatch {
  stage: AdaptiveStage;
  signature: string;
}

const FAMILY_QUERY = /(?:^|[?&])(view|targetview|cityid|catid|subcatid)=/i;
const FAMILY_TEXT = /make a post|please select a city|please select a category to post to|please select a subcategory(?: to post to)?/i;
const ENTRY_TEXT = /post\s+(?:a\s+)?free\s+ad|make\s+a\s+post|submit\s+(?:a\s+)?listing|add\s+(?:a\s+)?listing/i;

export function classifyXZeroFamily(url: string, bodyText: string, hasForm: boolean): XZeroFamilyMatch | null {
  const parsed = new URL(url, "https://family.invalid/");
  const query = parsed.search;
  const text = bodyText.replace(/\s+/g, " ").trim();
  const family = FAMILY_QUERY.test(query) || FAMILY_TEXT.test(text);
  if (!family) return null;

  if (/please select a subcategory(?: to post to)?/i.test(text)) return { stage: "SUBCATEGORY", signature: "XZero heading: subcategory" };
  if (/please select a category to post to/i.test(text)) return { stage: "CATEGORY", signature: "XZero heading: category" };
  if (/please select a city/i.test(text)) return { stage: "LOCATION", signature: "XZero heading: city" };
  if (hasForm || /make a post/i.test(text) || parsed.searchParams.has("subcatid")) return { stage: "FORM", signature: "XZero form state" };
  if (parsed.searchParams.get("view")?.toLowerCase() === "selectcity") return { stage: "LOCATION", signature: "XZero query: view=selectcity" };
  if (parsed.searchParams.has("catid")) return { stage: "SUBCATEGORY", signature: "XZero query: catid" };
  if (parsed.searchParams.has("cityid")) return { stage: "CATEGORY", signature: "XZero query: cityid" };
  if (parsed.searchParams.get("targetview")?.toLowerCase() === "post" || parsed.searchParams.get("view")?.toLowerCase() === "post") return { stage: "LOCATION", signature: "XZero query: post" };
  return ENTRY_TEXT.test(text) ? { stage: "ENTRY", signature: "XZero entry signature" } : null;
}

export function isXZeroEntryControl(text: string, href?: string): boolean {
  return Boolean(href && /(?:[?&](?:view|targetview)=post|[?&]view=selectcity|[?&]cityid=)/i.test(href)) || ENTRY_TEXT.test(text);
}
