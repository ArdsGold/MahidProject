import { chooseStructuralRecipe, type StructuralEvidence, type StructuralRecipeMatch } from "./automation/structural-signature";

export interface SiteFlowRecipe {
  id: string;
  domain: string;
  version: number;
  entryUrl: string;
  learnedAt: string;
  updatedAt: string;
  successCount: number;
  failureCount: number;
  categoryMappings?: SiteCategoryMapping[];
  lastSuccessfulAt?: string;
  verificationStatus?: "learned" | "live-verified";
  entryBehavior?: "homepage-submit-links";
  fieldMappings?: Record<string, string>;
  categoryBehavior?: "profile-category-services-semantic";
  formSignature?: string;
  manualGates?: string[];
  pageSignatures?: string[];
  uploadMapping?: string;
  successIndicators?: string[];
  liveUrlHints?: string[];
  staleCount?: number;
}

export interface SiteCategoryMapping {
  profileKey: string;
  value: string;
  label: string;
  updatedAt: string;
}

export interface SiteFlowSuccessMetadata {
  verificationStatus?: "learned" | "live-verified";
  entryBehavior?: "homepage-submit-links";
  fieldMappings?: Record<string, string>;
  categoryBehavior?: "profile-category-services-semantic";
  formSignature?: string;
  manualGates?: string[];
  pageSignatures?: string[];
  uploadMapping?: string;
  successIndicators?: string[];
  liveUrlHints?: string[];
}

const STORAGE_KEY = "ba2.siteFlowRecipes";

function domain(value: string): string {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function normalizeCategoryKey(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(services?|company|business)\b/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean).map((token) => token.replace(/(ing|ers|es|s)$/, "")).join(" ");
}

export async function getSiteCategoryMapping(url: string, profileCategory: string): Promise<SiteCategoryMapping | null> {
  const recipe = await getSiteFlowRecipe(url);
  const key = normalizeCategoryKey(profileCategory);
  return recipe?.categoryMappings?.find((mapping) => mapping.profileKey === key) || null;
}

export async function getSiteFlowRecipe(url: string): Promise<SiteFlowRecipe | null> {
  const site = domain(url);
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const recipes = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] as SiteFlowRecipe[] : [];
  return recipes.find((recipe) => recipe.domain === site && recipe.failureCount < 3) || null;
}

export async function getCrossDomainStructuralRecipe(url: string, evidence: StructuralEvidence): Promise<StructuralRecipeMatch<SiteFlowRecipe> | null> {
  const site = domain(url);
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const recipes = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] as SiteFlowRecipe[] : [];
  return chooseStructuralRecipe(recipes, site, evidence);
}

export async function recordSiteFlowSuccess(url: string, entryUrl: string, categoryMapping?: { profileKey: string; value: string; label: string }, metadata?: SiteFlowSuccessMetadata): Promise<void> {
  const site = domain(url);
  if (!site) return;
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const recipes = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] as SiteFlowRecipe[] : [];
  const now = new Date().toISOString();
  const existing = recipes.find((recipe) => recipe.domain === site);
  const categoryMappings = categoryMapping
    ? [...(existing?.categoryMappings || []).filter((mapping) => mapping.profileKey !== categoryMapping.profileKey), { ...categoryMapping, updatedAt: now }]
    : existing?.categoryMappings;
  const next: SiteFlowRecipe = existing
    ? { ...existing, entryUrl, updatedAt: now, lastSuccessfulAt: now, successCount: existing.successCount + 1, failureCount: 0, categoryMappings, ...metadata }
    : { id: crypto.randomUUID(), domain: site, version: 1, entryUrl, learnedAt: now, updatedAt: now, lastSuccessfulAt: now, successCount: 1, failureCount: 0, categoryMappings, ...metadata };
  await chrome.storage.local.set({ [STORAGE_KEY]: [...recipes.filter((recipe) => recipe.domain !== site), next] });
}
