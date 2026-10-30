import { isAutomationExcluded, AUTOMATION_EXCLUDED_MESSAGE } from "@backlink-autofill/shared";
import type { BusinessProfile } from "@backlink-autofill/shared";
import { describeField, detectCandidateFields, type FieldElement } from "./field-detection";
import { mapFields, type FieldMatch } from "./field-mapping";
import type { AutofillReport, FilledFieldReport, SkippedFieldReport } from "../messages";

/**
 * Safe autofill execution.
 *
 * Guarantees (Milestone 1 and beyond):
 * - never submits a form (no form.submit / requestSubmit)
 * - never clicks anything (no element.click())
 * - never touches checkbox / radio / file / hidden inputs; password fields use only saved profile password data
 * - never fills read-only or disabled fields
 */
function setNativeValue(element: FieldElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function profileValue(profile: BusinessProfile, field: FieldMatch["field"]): string {
  switch (field) {
    case "businessName":
      return profile.businessName;
    case "contactName":
      return profile.contactName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.businessName;
    case "firstName":
      return profile.firstName;
    case "lastName":
      return profile.lastName;
    case "username":
      return profile.username;
    case "email":
      return profile.email;
    case "password":
      return profile.password;
    case "phone":
      return profile.phone;
    case "website":
      return profile.website;
  }
}

export function runAutofill(profile: BusinessProfile): AutofillReport {
  if (isAutomationExcluded(location.href)) return { profileName: profile.businessName || "Untitled", filled: [], skipped: [{ descriptor: "page", reason: AUTOMATION_EXCLUDED_MESSAGE }] };
  const fields = detectCandidateFields(document);
  const { matches, rejected } = mapFields(fields);

  const filled: FilledFieldReport[] = [];
  const skipped: SkippedFieldReport[] = [];
  const usedSlots = new Set<FieldMatch["field"]>();

  for (const match of matches) {
    const descriptor = describeField(match.signals);
    const value = profileValue(profile, match.field);
    if (usedSlots.has(match.field) && match.field !== "password") {
      skipped.push({ descriptor, reason: `slot "${match.field}" already filled` });
      continue;
    }
    if (!value) {
      skipped.push({ descriptor, reason: `no data for "${match.field}" in active profile` });
      continue;
    }
    setNativeValue(match.signals.element, value);
    usedSlots.add(match.field);
    filled.push({ field: match.field, descriptor, value: match.field === "password" ? "[masked]" : value });
  }

  for (const entry of rejected) {
    skipped.push({ descriptor: describeField(entry.signals), reason: entry.reason });
  }

  return {
    profileName: profile.businessName || "Untitled",
    filled,
    skipped,
  };
}
