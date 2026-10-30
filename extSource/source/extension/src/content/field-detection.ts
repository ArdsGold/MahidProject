export type FieldElement = HTMLInputElement | HTMLTextAreaElement;

export interface FieldSignals {
  element: FieldElement;
  label: string;
  name: string;
  id: string;
  placeholder: string;
  type: string;
  context: string;
}

const SKIPPED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "file",
  "checkbox",
  "radio",
]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function labelFor(element: FieldElement): string {
  const parts: string[] = [];

  const labels = element.labels;
  if (labels) {
    for (const label of Array.from(labels)) {
      parts.push(label.textContent ?? "");
    }
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    parts.push(ariaLabel);
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const target = document.getElementById(id);
      if (target) {
        parts.push(target.textContent ?? "");
      }
    }
  }

  return normalizeText(parts.join(" "));
}

function contextFor(element: FieldElement): string {
  const parts: string[] = [];

  const fieldset = element.closest("fieldset");
  const legend = fieldset?.querySelector("legend");
  if (legend) {
    parts.push(legend.textContent ?? "");
  }

  const row = element.closest("tr");
  const rowHeader = row?.querySelector("th");
  if (rowHeader) {
    parts.push(rowHeader.textContent ?? "");
  }

  const previous = element.previousElementSibling;
  if (previous && !["input", "textarea", "select", "button"].includes(previous.tagName.toLowerCase())) {
    const text = normalizeText(previous.textContent ?? "");
    if (text.length > 0 && text.length <= 60) {
      parts.push(text);
    }
  }

  // Auth forms often leave the identifier unlabeled; retain bounded form-level
  // wording so the mapper can distinguish that from ordinary listing fields.
  const formText = element.closest("form")?.textContent;
  if (formText) {
    parts.push(normalizeText(formText).slice(0, 1000));
  }

  return normalizeText(parts.join(" "));
}

function isEditableTextElement(element: Element): element is FieldElement {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly && !SKIPPED_INPUT_TYPES.has(element.type);
  }
  return false;
}

/**
 * Collects editable text-like fields and the semantic signals used for
 * conservative mapping. Read-only, disabled, and non-text inputs are excluded
 * here so downstream modules never consider them.
 */
export function detectCandidateFields(root: ParentNode = document): FieldSignals[] {
  const elements = root.querySelectorAll("input, textarea");
  const signals: FieldSignals[] = [];

  for (const element of Array.from(elements)) {
    if (!isEditableTextElement(element)) {
      continue;
    }
    if (!element.isConnected) {
      continue;
    }
    signals.push({
      element,
      label: labelFor(element),
      name: normalizeText(element.getAttribute("name") ?? ""),
      id: normalizeText(element.getAttribute("id") ?? ""),
      placeholder: normalizeText(element.getAttribute("placeholder") ?? ""),
      type: element instanceof HTMLInputElement ? element.type.toLowerCase() : "textarea",
      context: contextFor(element),
    });
  }

  return signals;
}

export function describeField(signals: FieldSignals): string {
  const element = signals.element;
  const tag = element.tagName.toLowerCase();
  const name = element.getAttribute("name");
  const id = element.getAttribute("id");
  const bits = [tag];
  if (name) {
    bits.push(`name="${name}"`);
  }
  if (id) {
    bits.push(`id="${id}"`);
  }
  return bits.join(" ");
}
