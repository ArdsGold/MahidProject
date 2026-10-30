import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";
import { jetLinksSite } from "./jet-links";
import type { ListingAutofillReport } from "../messages";

// Verified EFdir HTTP/HTTPS form matches existing F07 Terms/Continue contract.
// Explicit user request authorizes this checkbox only, not CAPTCHA or submission.
export const efdirSite = { ...jetLinksSite, id: "efdir", domain: "efdir.com", name: "Efdir", startingUrl: "http://efdir.com/", protocols: ["http:", "https:"] };
export const efdirAdapter = createNativeDirectoryAdapter(efdirSite);
export const isEfdirHost = (value: string) => isNativeDirectoryHost(value, efdirSite.domain);
export const inspectEfdir = (doc: Document, value: string) => inspectNativeDirectory(doc, value, efdirSite);

export function applyAuthorizedEfdirTerms(doc: Document, value: string, originalForm: HTMLFormElement | undefined, report: ListingAutofillReport): void {
  // Explicit user authorization for THIS recorded Efdir workflow, 2026-10-19.
  // This grants checkbox selection only, never Continue/publication or Jet consent.
  if (!originalForm || report.skipped.length || report.navigationUrl || report.filled.length !== 6
    || !["businessName", "website", "description", "contactName", "email", "category"].every(field => report.filled.some(item => item.field === field))) return;
  const current = inspectEfdir(doc, value);
  if (current.state !== "form" || current.form !== originalForm) return;
  const checkbox = current.form.querySelector<HTMLInputElement>('input[name="agree"]')!;
  for (let node: Element | null = checkbox; node; node = node.parentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return;
  }
  // No click/change events: selecting consent cannot dispatch a site action.
  checkbox.checked = true;
  if (!checkbox.checked) { report.manual.push("Efdir Terms checkbox did not retain selection; review required"); return; }
  report.manual = report.manual.filter(item => item !== "Terms/Agreement" && !item.startsWith("Accept Terms of Agreement checkbox"));
  report.manual.push("Efdir Terms checkbox selected under explicit workflow authorization; CAPTCHA and Continue remain manual");
}
