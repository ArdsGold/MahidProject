import type { BusinessProfile } from "@backlink-autofill/shared";
import { confidenceDecision, type Decision } from "./action-system";

export interface RankedOption { value: string; label: string; score: number; }

export function normalizeChoice(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/\b(u\.?s\.?a?\.?|united states of america)\b/g, "united states").replace(/[^a-z0-9]+/g, " ").trim();
}

function words(value: string): Set<string> { return new Set(normalizeChoice(value).split(" ").filter((token) => token.length > 2)); }

export function rankLocationOptions(options: string[], wanted: string, aliases: string[] = []): RankedOption[] {
  const targets = [wanted, ...aliases].filter(Boolean).map(normalizeChoice);
  return options.map((label) => {
    const normalized = normalizeChoice(label);
    const score = targets.some((target) => normalized === target) ? 1 : [...words(normalized)].filter((word) => targets.some((target) => words(target).has(word))).length / Math.max(words(wanted).size, 1);
    return { value: label, label, score };
  }).sort((a, b) => b.score - a.score);
}

export function decideLocation(options: string[], wanted: string, aliases: string[] = []): Decision {
  const ranked = rankLocationOptions(options, wanted, aliases);
  const best = ranked[0];
  const margin = best && ranked[1] ? best.score - ranked[1].score : best?.score || 0;
  const confidence = best && best.score > 0 && margin > 0 ? Math.min(1, 0.75 + best.score * 0.25) : 0;
  return best && best.score > 0 && margin > 0
    ? { decision: "continue", confidence, reason: `Matched location option ${best.label}`, action: { action: "SELECT", target: "location", value: best.value, confidence, reason: "Normalized exact or alias location match" } }
    : { decision: "ask-human", confidence, reason: "No unambiguous location option; do not invent a geographic value", action: { action: "ASK_HUMAN", target: "location", confidence, reason: "Location requires manual confirmation" } };
}

export function rankCategoryOptions(options: string[], profile: BusinessProfile): RankedOption[] {
  const desired = [profile.category, ...profile.services, profile.description, profile.shortDescription].filter(Boolean);
  const businessWords = words(profile.businessName);
  const context = normalizeChoice(desired.join(" "));
  const serviceSignal = /\b(service|services|removal|hauling|cleaning|repair|contractor|professional|consulting|installation|maintenance)\b/.test(context);
  return options.map((label) => {
    const labelWords = words(label);
    let score = 0;
    for (const value of desired) {
      const overlap = [...words(value)].filter((word) => labelWords.has(word)).length;
      score = Math.max(score, overlap / Math.max(words(value).size, 1));
    }
    score += [...businessWords].filter((word) => labelWords.has(word)).length * 0.05;
    if (normalizeChoice(label) === "services" && serviceSignal) score = Math.max(score, 0.85);
    return { value: label, label, score };
  }).sort((a, b) => b.score - a.score);
}

export function decideCategory(options: string[], profile: BusinessProfile, target = "category"): Decision {
  const ranked = rankCategoryOptions(options, profile);
  const best = ranked[0];
  const margin = best && ranked[1] ? best.score - ranked[1].score : best?.score || 0;
  const confidence = best && best.score > 0 && margin > 0 ? Math.min(1, 0.65 + best.score * 0.35) : 0;
  return best && best.score > 0 && margin > 0
    ? { decision: "continue", confidence, reason: `Best semantic match from actual ${target} options`, action: { action: "SELECT", target, value: best.value, confidence, reason: "Matched category, services, and profile description" } }
    : { decision: "ask-human", confidence, reason: "Category options are ambiguous or unrelated", action: { action: "ASK_HUMAN", target, confidence, reason: "Category requires manual selection" } };
}

const SUBCATEGORY_CONCEPTS = [
  ["medical", "clinic", "clinics", "doctor", "physician", "vein", "dermatology", "skin", "surgery"],
  ["health", "fitness", "wellness", "therapy", "nutrition", "rehabilitation"],
  ["hair", "beauty", "cosmetic", "aesthetic", "spa"],
  ["cleaning", "chores", "housekeeping", "maid"],
  ["removal", "packing", "moving", "haul", "hauling"],
  ["plumbing", "pools", "pool", "plumber"],
  ["roofing", "tiling", "roof", "tile"],
];

export function rankSubcategoryOptions(options: string[], profile: BusinessProfile): RankedOption[] {
  const authoritative = [profile.category, ...profile.services, profile.description, profile.shortDescription].filter(Boolean);
  const supporting = words(profile.businessName);
  return options.map((label) => {
    const labelWords = words(label);
    let score = 0;
    for (const value of authoritative) {
      const valueWords = words(value);
      const overlap = [...valueWords].filter((word) => labelWords.has(word)).length;
      score = Math.max(score, overlap / Math.max(labelWords.size, 1), overlap / Math.max(valueWords.size, 1) * 0.85);
      for (const concept of SUBCATEGORY_CONCEPTS) {
        if (concept.some((word) => valueWords.has(word)) && concept.some((word) => labelWords.has(word))) score = Math.max(score, 0.8);
      }
    }
    score += [...supporting].filter((word) => labelWords.has(word)).length * 0.05;
    return { value: label, label, score };
  }).sort((a, b) => b.score - a.score);
}

export function decideSubcategory(options: string[], profile: BusinessProfile): Decision & { recommendations: RankedOption[] } {
  const ranked = rankSubcategoryOptions(options, profile);
  const best = ranked[0];
  const margin = best && ranked[1] ? best.score - ranked[1].score : best?.score || 0;
  const confidence = best ? Math.min(1, 0.65 + best.score * 0.35) : 0;
  return {
    ...(best && best.score > 0 && margin > 0
      ? { decision: "continue" as const, confidence, reason: "Best semantic match from actual subcategory options", action: { action: "SELECT" as const, target: "subcategory", value: best.value, confidence, reason: "Matched profile category, services, description, and keywords" } }
      : { decision: "ask-human" as const, confidence, reason: "Subcategory options are ambiguous or unrelated", action: { action: "ASK_HUMAN" as const, target: "subcategory", confidence, reason: "Subcategory requires approval" } }),
    recommendations: ranked.slice(0, 3).filter((option) => option.score > 0),
  };
}

export { confidenceDecision };
