import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";
import { jetLinksSite } from "./jet-links";
import type { ListingAutofillReport } from "../messages";

// Captured Adbrite F07 form and user Codegen workflow match Jet's control contract.
// GET-verified HTTP and HTTPS www forms share this contract. Keep Chrome's TLS
// validation and the coordinator's HTTPS-downgrade refusal unchanged.
export const adbriteDirectorySite = { ...jetLinksSite, id: "adbrite-directory", domain: "adbritedirectory.com", name: "Adbrite Directory", startingUrl: "https://www.adbritedirectory.com/", protocols: ["http:", "https:"] };
export const adbriteDirectoryAdapter = createNativeDirectoryAdapter(adbriteDirectorySite);
export const isAdbriteDirectoryHost = (value: string) => isNativeDirectoryHost(value, adbriteDirectorySite.domain);
export const inspectAdbriteDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, adbriteDirectorySite);

export function applyAuthorizedAdbriteTerms(doc: Document, value: string, originalForm: HTMLFormElement | undefined, report: ListingAutofillReport): void {
  // Explicit user authorization for THIS recorded Adbrite workflow, 2026-10-18.
  // This grants checkbox selection only, never Continue/publication or Jet consent.
  if (!originalForm || report.skipped.length || report.navigationUrl || report.filled.length !== 6
    || !["businessName", "website", "description", "contactName", "email", "category"].every(field => report.filled.some(item => item.field === field))) return;
  const current = inspectAdbriteDirectory(doc, value);
  if (current.state !== "form" || current.form !== originalForm) return;
  const checkbox = current.form.querySelector<HTMLInputElement>('input[name="agree"]')!;
  for (let node: Element | null = checkbox; node; node = node.parentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return;
  }
  // No click/change events: selecting consent cannot dispatch a site action.
  checkbox.checked = true;
  if (!checkbox.checked) { report.manual.push("Adbrite Terms checkbox did not retain selection; review required"); return; }
  report.manual = report.manual.filter(item => item !== "Terms/Agreement" && !item.startsWith("Accept Terms of Agreement checkbox"));
  report.manual.push("Adbrite Terms checkbox selected under explicit workflow authorization; CAPTCHA and Continue remain manual");
}
