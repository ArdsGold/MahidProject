import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";
import type { ListingAutofillReport } from "../messages";

// Same F05/native form as Reddit; Familydir's verified entry is Submit Link.
const site = { id: "familydir", domain: "familydir.com", name: "Familydir", startingUrl: "https://familydir.com/", protocols: ["https:"], entryLabels: ["Submit Link"], manualRadio: { name: "LINK_TYPE", value: "normal" } };
export const familydirAdapter = createNativeDirectoryAdapter(site);
export const isFamilydirHost = (value: string) => isNativeDirectoryHost(value, site.domain);

export function inspectFamilydir(doc: Document, value: string) {
  const result = inspectNativeDirectory(doc, value, site);
  if (result.state !== "form") return result;
  const radio = result.form.querySelector<HTMLInputElement>('input[name="LINK_TYPE"]')!;
  const row = radio.closest('tr');
  const cells = row ? [...row.children].filter(el => el.tagName === 'TD') : [];
  const text = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim();
  if (cells.length !== 2 || !cells[0].contains(radio) || text(cells[0]) !== 'Regular Reviews' || text(cells[1])?.toLowerCase() !== 'free'
    || row!.querySelectorAll('input,textarea,select,button').length !== 1 || row!.querySelector('a')) {
    return { state: "unsupported" as const, reason: "Familydir listing type must be the verified free Regular Reviews option" };
  }
  for (let node: Element | null = radio; node; node = node.parentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (node.matches('[hidden],[inert],[aria-hidden="true"]') || style?.display === 'none' || style?.visibility === 'hidden') {
      return { state: "unsupported" as const, reason: "Familydir free listing option is hidden or unavailable" };
    }
  }
  return result;
}

export function selectFamilydirFreeReview(doc: Document, value: string, originalForm: HTMLFormElement | undefined, report: ListingAutofillReport): void {
  // User requested the demonstrated radio. Exact label/price validation binds
  // this to the free plan only, after the existing mapper validates all6 fields.
  if (!originalForm || report.navigationUrl || report.skipped.length || report.filled.length !== 6
    || !['businessName', 'website', 'description', 'contactName', 'email', 'category'].every(field => report.filled.some(item => item.field === field))) return;
  const current = inspectFamilydir(doc, value);
  if (current.state !== 'form' || current.form !== originalForm) return;
  const radio = current.form.querySelector<HTMLInputElement>('input[name="LINK_TYPE"]')!;
  if (!radio.checked) radio.checked = true; // No click/change events or submission.
  if (!radio.checked) { report.manual.push('Familydir free listing selection did not remain checked; review required'); return; }
  report.manual = report.manual.filter(item => item !== 'LINK_TYPE listing type requires human selection; left unchanged');
  report.manual.push('Free Regular Reviews listing type selected; CAPTCHA and Continue remain manual');
}
