import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";
import type { ListingAutofillReport } from "../messages";

// Captured F08: one free Regular links radio; native Submit stays manual.
export const fireDirectorySite = { id: "fire-directory", domain: "fire-directory.com", name: "Fire Directory", startingUrl: "https://fire-directory.com/", protocols: ["https:"], entryLabels: ["Add Site"], manualRadio: { name: "LINK_TYPE", value: "normal" }, submitValue: "Submit" as const };
export const fireDirectoryAdapter = createNativeDirectoryAdapter(fireDirectorySite);
export const isFireDirectoryHost = (value: string) => isNativeDirectoryHost(value, fireDirectorySite.domain);
export const inspectFireDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, fireDirectorySite);

export function selectFireRegularLink(doc: Document, value: string, originalForm: HTMLFormElement | undefined, report: ListingAutofillReport): void {
  // User authorized the sole recorded radio; no extra approval UI.
  // Select only in the same form after all six mapped values validate.
  if (!originalForm || report.navigationUrl || report.skipped.length || report.filled.length !== 6
    || !['businessName', 'website', 'description', 'contactName', 'email', 'category'].every(field => report.filled.some(item => item.field === field))) return;
  const current = inspectFireDirectory(doc, value);
  if (current.state !== 'form' || current.form !== originalForm) return;
  const radio = current.form.querySelector<HTMLInputElement>('input[name="LINK_TYPE"]')!;
  if (!radio.checked) radio.checked = true; // No click/change events or submission.
  if (!radio.checked) { report.manual.push('Fire Directory free listing selection did not remain checked; review required'); return; }
  report.manual = report.manual.filter(item => item !== 'LINK_TYPE listing type requires human selection; left unchanged');
  report.manual.push('Free Regular links listing type selected; CAPTCHA and Submit remain manual');
}
