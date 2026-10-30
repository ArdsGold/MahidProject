export type AdaptiveStage = "ENTRY" | "LOCATION" | "CATEGORY" | "SUBCATEGORY" | "FORM" | "HUMAN_GATE" | "UNKNOWN";

export interface AdaptiveCandidate { text: string; href?: string; confidence: number; }
export interface AdaptiveStageSignals {
  hasLocationOptions?: boolean;
  hasCategoryOptions?: boolean;
  hasMeaningfulFormControls?: boolean;
}

const ENTRY_PATTERNS = [/post\s+(?:a\s+)?free\s+ad/i, /submit\s+(?:a\s+)?listing/i, /submit\s+link/i, /add\s+(?:a\s+)?(?:listing|business|website)/i, /create\s+(?:a\s+)?listing/i, /post\s+ad/i, /free\s+listing/i, /list\s+your\s+business/i];
const PAYMENT_GATE = /payment\s+(?:method|details|information|required|options)|proceed\s+to\s+payment|make\s+a\s+payment|pay\s+now|credit card|billing\s+(?:address|information)/i;

export function adaptiveHumanGateReasons(bodyText: string): string[] {
  const text = bodyText.toLowerCase();
  const reasons: string[] = [];
  if (/captcha|recaptcha|hcaptcha|turnstile/.test(text)) reasons.push("CAPTCHA");
  if (/account verification|manual verification|verify you are human|security check/.test(text)) reasons.push("Manual verification");
  if (PAYMENT_GATE.test(text)) reasons.push("Payment/manual action");
  if (/terms of use|privacy policy/.test(text)) reasons.push("Terms/Agreement");
  return reasons;
}

export function scoreAdaptiveEntry(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  const exact = ENTRY_PATTERNS.some((pattern) => pattern.test(normalized));
  if (exact) return 0.94;
  if (/submit|listing|business|website|post|ad/i.test(normalized)) return 0.55;
  return 0;
}

export function chooseAdaptiveEntry(candidates: AdaptiveCandidate[]): { action: "AUTO" | "ASK_HUMAN" | "NONE"; candidate?: AdaptiveCandidate; reason: string } {
  const ranked = candidates.map((candidate) => ({ ...candidate, confidence: Math.max(candidate.confidence, scoreAdaptiveEntry(candidate.text)) })).filter((candidate) => candidate.confidence > 0).sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  if (!best) return { action: "NONE", reason: "No safe listing-start candidate found" };
  if (best.confidence >= 0.85) return { action: "AUTO", candidate: best, reason: `High-confidence listing entry: ${best.text}` };
  return { action: "ASK_HUMAN", candidate: best, reason: `Medium-confidence listing entry candidate: ${best.text}` };
}

export function classifyAdaptiveStage(bodyText: string, hasForm: boolean, hasFileInput: boolean, signals: AdaptiveStageSignals = {}): AdaptiveStage {
  const text = bodyText.toLowerCase();
  const meaningfulForm = Boolean(signals.hasMeaningfulFormControls) || hasFileInput && /title|description|website|email|business/.test(text);
  if (meaningfulForm) return "FORM";
  if (adaptiveHumanGateReasons(text).length) return "HUMAN_GATE";
  if (hasForm) return "FORM";
  if (/please select a subcategory|select (?:a )?sub[- ]?categor(?:y|ies)|choose (?:a )?sub[- ]?categor(?:y|ies)|child categor/.test(text)) return "SUBCATEGORY";
  if (/please select a category to post to|please select a categor(?:y|ies)|select (?:a )?categor(?:y|ies)|choose (?:a )?categor(?:y|ies)|business type|listing type|industry/.test(text)
    || signals.hasCategoryOptions && /categor|business type|listing type|industry/.test(text)) return "CATEGORY";
  if (/please select a city|select (?:a )?city|choose (?:a )?city|select (?:a )?location|choose (?:a )?location|where is your business/.test(text)
    || signals.hasLocationOptions && /location|country|state|province|city/.test(text)) return "LOCATION";
  if (ENTRY_PATTERNS.some((pattern) => pattern.test(text))) return "ENTRY";
  return "UNKNOWN";
}

export function hasMeaningfulFormControlsGeneric(editableCount: number, fileInputCount: boolean, text: string): boolean {
  if (editableCount >= 3) return true;
  if (fileInputCount && /title|description|website|email|business|logo|photo|attachment/.test(text)) return true;
  if (editableCount >= 2 && /title|description|website|email|business|logo|photo|attachment/.test(text)) return true;
  return false;
}
