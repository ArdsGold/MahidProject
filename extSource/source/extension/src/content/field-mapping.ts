import { AUTOFILL_FIELDS, type AutofillField } from "@backlink-autofill/shared";
import type { FieldSignals } from "./field-detection";

interface Keyword {
  phrase: string;
  weight: number;
}

/**
 * Conservative semantic matching for generic profile and submission forms.
 *
 * Each candidate field is scored against a fixed set of slots using
 * label / name / id / placeholder / type / nearby-context signals.
 * A field is filled when the best slot has semantic evidence and is not tied
 * with another slot. Confidence affects diagnostics, not execution.
 */
const KEYWORDS: Record<AutofillField, Keyword[]> = {
  businessName: [
    { phrase: "business name", weight: 3.5 },
    { phrase: "company name", weight: 3.5 },
    { phrase: "organization name", weight: 3.5 },
    { phrase: "organisation name", weight: 3.5 },
    { phrase: "store name", weight: 3.5 },
    { phrase: "practice name", weight: 3.5 },
    { phrase: "establishment", weight: 2.8 },
    { phrase: "business", weight: 2.6 },
    { phrase: "company", weight: 2.6 },
    { phrase: "org name", weight: 3.0 },
  ],
  contactName: [
    { phrase: "contact name", weight: 3.5 },
    { phrase: "full name", weight: 3.5 },
    { phrase: "person name", weight: 3.5 },
    { phrase: "contact person", weight: 3.5 },
    { phrase: "your name", weight: 3.2 },
    { phrase: "contact", weight: 2.5 },
    { phrase: "name", weight: 2.5 },
  ],
  firstName: [{ phrase: "first name", weight: 3.5 }, { phrase: "given name", weight: 3.5 }, { phrase: "forename", weight: 3.2 }],
  lastName: [{ phrase: "last name", weight: 3.5 }, { phrase: "surname", weight: 3.5 }, { phrase: "family name", weight: 3.5 }],
  username: [{ phrase: "username", weight: 4 }, { phrase: "user name", weight: 4 }, { phrase: "login name", weight: 4 }, { phrase: "account name", weight: 3.8 }, { phrase: "user id", weight: 3.8 }, { phrase: "member name", weight: 3.8 }],
  email: [
    { phrase: "email address", weight: 3.5 },
    { phrase: "e-mail address", weight: 3.5 },
    { phrase: "email", weight: 3.0 },
    { phrase: "e-mail", weight: 3.0 },
    { phrase: "mailing email", weight: 3.2 },
  ],
  password: [{ phrase: "password", weight: 4 }, { phrase: "passcode", weight: 3.5 }],
  phone: [
    { phrase: "phone number", weight: 3.5 },
    { phrase: "telephone number", weight: 3.5 },
    { phrase: "contact number", weight: 3.5 },
    { phrase: "mobile number", weight: 3.5 },
    { phrase: "cell phone", weight: 3.5 },
    { phrase: "phone", weight: 3.0 },
    { phrase: "telephone", weight: 3.0 },
    { phrase: "mobile", weight: 2.8 },
    { phrase: "tel", weight: 2.5 },
    { phrase: "cell", weight: 2.5 },
  ],
  website: [
    { phrase: "website url", weight: 3.5 },
    { phrase: "web site url", weight: 3.5 },
    { phrase: "site url", weight: 3.5 },
    { phrase: "website", weight: 3.0 },
    { phrase: "web site", weight: 3.0 },
    { phrase: "web address", weight: 3.0 },
    { phrase: "homepage", weight: 2.8 },
    { phrase: "home page", weight: 2.8 },
    { phrase: "domain", weight: 2.4 },
    { phrase: "url", weight: 2.2 },
  ],
};

const TYPE_BONUS: Partial<Record<string, { field: AutofillField; weight: number }>> = {
  email: { field: "email", weight: 3.0 },
  tel: { field: "phone", weight: 2.6 },
  url: { field: "website", weight: 2.2 },
};

/** Signals that make a field unsafe or wrong to fill, regardless of score. */
const BLOCK_PATTERNS: RegExp[] = [
  /\bcaptcha\b/,
  /\bverify\b/,
  /\bconfirm\b/,
  /\bre-?enter\b/,
  /\brepeat\b/,
  /\bnewsletter\b/,
  /\bsubscribe\b/,
  /\bsubscription\b/,
  /\bsearch\b/,
  /\bterms\b/,
  /\bagree\b/,
  /\bagreement\b/,
  /\bopt-?in\b/,
  /\bpassword\b/,
];

const SOURCE_WEIGHTS = {
  label: 1.0,
  name: 0.85,
  id: 0.85,
  placeholder: 0.85,
  context: 0.5,
} as const;

export interface SlotScore {
  field: AutofillField;
  score: number;
}

export interface FieldMatch {
  signals: FieldSignals;
  field: AutofillField;
  score: number;
  slots: SlotScore[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseScore(text: string, keywords: Keyword[]): number {
  let best = 0;
  for (const keyword of keywords) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword.phrase)}([^a-z0-9]|$)`, "i");
    if (pattern.test(text)) {
      const exactBonus = text === keyword.phrase ? 0.5 : 0;
      const score = keyword.weight + exactBonus;
      if (score > best) {
        best = score;
      }
    }
  }
  return best;
}

function isBlocked(signals: FieldSignals): boolean {
  const combined = [signals.label, signals.name, signals.id, signals.placeholder]
    .filter(Boolean)
    .join(" ");
  const passwordField = signals.type === "password" || /\bpassword\b|passcode/.test(combined);
  return passwordField ? false : BLOCK_PATTERNS.some((pattern) => pattern.test(combined));
}

function isAuthForm(signals: FieldSignals, combined: string): boolean {
  const hasAuthAction = /\b(?:sign\s*in|sign\s*up|log\s*in(?!\s+(?:name|id))|login(?!\s+(?:name|id)))\b|\b(?:register|registration)\b|\bcreate\s+(?:an?\s+)?account\b/i.test(combined);
  const hasPassword = /\bpassword\b|passcode/i.test(combined);
  const hasLoginSupport = /\b(?:username|user\s+name|login\s+name|account\s+name|user\s+id|member\s+name|forgot\s+password|remember\s+me)\b|\be[- ]?mail\b/i.test(combined);
  return Boolean(signals.element.closest("form")) && hasAuthAction && hasPassword && hasLoginSupport;
}

function scoreSlots(signals: FieldSignals): SlotScore[] {
  const sources: Array<[string, number]> = [
    [signals.label, SOURCE_WEIGHTS.label],
    [signals.name, SOURCE_WEIGHTS.name],
    [signals.id, SOURCE_WEIGHTS.id],
    [signals.placeholder, SOURCE_WEIGHTS.placeholder],
    [signals.context, SOURCE_WEIGHTS.context],
  ];

  const combined = [signals.label, signals.name, signals.id, signals.placeholder, signals.context].filter(Boolean).join(" ");
  const semanticText = combined.replace(/[_-]+/g, " ");
  const localSemanticText = [signals.label, signals.name, signals.id, signals.placeholder].filter(Boolean).join(" ").replace(/[_-]+/g, " ");
  const explicitlyFirstName = /\b(?:first|given|forename)\s+name\b/.test(localSemanticText);
  const explicitlyLastName = /\b(?:last|sur|family)\s+name\b/.test(localSemanticText);
  const explicitlyUsername = /\b(?:username|user\s+name|login\s+name|account\s+name|user\s+id|member\s+name)\b/.test(localSemanticText);
  const explicitlyEmail = !explicitlyUsername && (signals.type === "email" || /\be[- ]?mail\b/.test(localSemanticText));
  const passwordSemantic = signals.type === "password" || /\bpassword\b|passcode/.test(localSemanticText);
  const authIdentifier = isAuthForm(signals, semanticText) && !explicitlyEmail && !passwordSemantic;
  return AUTOFILL_FIELDS.map((field) => {
    let score = explicitlyFirstName && field === "firstName" ? 14
      : explicitlyLastName && field === "lastName" ? 14
      : explicitlyEmail && field === "username" ? 0
      : explicitlyUsername && field === "username" ? 10
      : authIdentifier && field === "username" ? 12
      : 0;
    for (const [text, multiplier] of sources) {
      if (!text) {
        continue;
      }
      score += phraseScore(text, KEYWORDS[field]) * multiplier;
    }
    const typeBonus = TYPE_BONUS[signals.type];
    if (typeBonus && typeBonus.field === field) {
      score += typeBonus.weight;
    }
    return { field, score };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Maps detected fields to profile slots. Low-confidence matches still use the
 * best available profile-backed slot; only blocked, unsupported, or tied fields
 * remain unmapped.
 */
export function mapFields(signals: FieldSignals[]): {
  matches: FieldMatch[];
  rejected: Array<{ signals: FieldSignals; reason: string }>;
} {
  const matches: FieldMatch[] = [];
  const rejected: Array<{ signals: FieldSignals; reason: string }> = [];

  for (const fieldSignals of signals) {
    if (isBlocked(fieldSignals)) {
      rejected.push({ signals: fieldSignals, reason: "blocked pattern (captcha/terms/etc.)" });
      continue;
    }

    const slots = scoreSlots(fieldSignals);
    const [best, runnerUp] = slots;

    if (!best || best.score <= 0) {
      rejected.push({ signals: fieldSignals, reason: "unmapped: no profile field evidence" });
      continue;
    }
    if (runnerUp && best.score === runnerUp.score) {
      rejected.push({ signals: fieldSignals, reason: "unmapped: tied semantic matches" });
      continue;
    }

    matches.push({ signals: fieldSignals, field: best.field, score: best.score, slots });
  }

  return { matches, rejected };
}
