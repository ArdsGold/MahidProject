export const TERMS_APPROVALS_STORAGE_KEY = "ba2.termsApprovals";

export interface TermsApprovalRecord {
  siteKey: string;
  agreementKey: string;
  contentFingerprint: string;
  approvedBy: string;
  approvedAt: string;
  approvedByAuthorizedOperator: boolean;
  agreementVersion?: string;
}

export interface TermsAgreementCandidate {
  checkbox: HTMLInputElement;
  siteKey: string;
  agreementKey: string;
  agreementText: string;
  agreementVersion?: string;
  clearlyIdentified: boolean;
  reason?: string;
}

export interface TermsApprovalResult {
  candidate: TermsAgreementCandidate;
  status: "checked" | "human-review";
  reason: string;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeTermsSiteKey(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function agreementText(checkbox: HTMLInputElement): string {
  const labels = checkbox.labels ? Array.from(checkbox.labels).map((label) => label.textContent || "") : [];
  const labelledBy = (checkbox.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => checkbox.ownerDocument.getElementById(id)?.textContent || "");
  const direct = [
    ...labels,
    ...labelledBy,
    checkbox.getAttribute("aria-label") || "",
    checkbox.getAttribute("title") || "",
  ].filter(Boolean);
  const fallback = checkbox.parentElement?.textContent || "";
  return normalizeText((direct.length ? direct : [fallback]).join(" "));
}

function agreementIdentity(checkbox: HTMLInputElement): string {
  return [
    checkbox.id,
    checkbox.getAttribute("name") || "",
    checkbox.getAttribute("aria-labelledby") || "",
  ].find((value) => value.trim())?.trim().toLowerCase() || "terms";
}

function agreementVersion(checkbox: HTMLInputElement): string | undefined {
  return checkbox.getAttribute("data-terms-version") || checkbox.getAttribute("data-agreement-version") || undefined;
}

function candidateReason(text: string): string | undefined {
  const normalized = text.toLowerCase();
  const hasTerms = /\bterms?\b|\bconditions?\b/.test(normalized);
  const hasAgreementLanguage = /\bagree\b|\baccept\b|\backnowledge\b|\bconsent\b|\bterms?\b|\bconditions?\b/.test(normalized);
  const unsafeContext = /marketing|newsletter|promotional|advertis(?:e|ing)|payment|billing|credit\s*card|checkout|subscription|recurring/.test(normalized);
  if (!hasTerms) return "Checkbox is not identified as Terms/Conditions.";
  if (unsafeContext) return "Terms checkbox is combined with marketing, payment, or another opt-in.";
  if (!hasAgreementLanguage) return "Terms checkbox has no clear agreement language.";
  return undefined;
}

export function findTermsAgreementCandidates(documentRef: Document = document): TermsAgreementCandidate[] {
  const siteKey = normalizeTermsSiteKey(documentRef.location.href);
  return Array.from(documentRef.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .map((checkbox) => {
      const text = agreementText(checkbox);
      const reason = candidateReason(text);
      const identity = agreementIdentity(checkbox);
      const version = agreementVersion(checkbox);
      return {
        checkbox,
        siteKey,
        agreementKey: `${identity}:${text.toLowerCase()}`,
        agreementText: text,
        agreementVersion: version,
        clearlyIdentified: Boolean(text) && !reason,
        reason,
      };
    })
    .filter((candidate) => /\bterms?\b|\bconditions?\b/i.test(candidate.agreementText));
}

export async function fingerprintTermsAgreement(candidate: TermsAgreementCandidate): Promise<string> {
  const input = `${candidate.siteKey}\n${candidate.agreementKey}\n${candidate.agreementText}\n${candidate.agreementVersion || ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isTermsApprovalValid(
  candidate: TermsAgreementCandidate,
  currentFingerprint: string,
  approval: TermsApprovalRecord | undefined,
): boolean {
  if (!candidate.clearlyIdentified || !approval) return false;
  if (typeof approval.siteKey !== "string" || typeof approval.agreementKey !== "string" || typeof approval.contentFingerprint !== "string") return false;
  if (typeof approval.approvedBy !== "string" || typeof approval.approvedAt !== "string") return false;
  if (approval.siteKey !== candidate.siteKey || approval.agreementKey !== candidate.agreementKey) return false;
  if (approval.contentFingerprint !== currentFingerprint) return false;
  if (!approval.approvedBy.trim() || approval.approvedByAuthorizedOperator !== true) return false;
  if (!Number.isFinite(Date.parse(approval.approvedAt))) return false;
  if (approval.agreementVersion && approval.agreementVersion !== candidate.agreementVersion) return false;
  return true;
}

async function readTermsApprovals(): Promise<TermsApprovalRecord[]> {
  try {
    const data = await chrome.storage.local.get(TERMS_APPROVALS_STORAGE_KEY);
    return Array.isArray(data[TERMS_APPROVALS_STORAGE_KEY]) ? data[TERMS_APPROVALS_STORAGE_KEY] as TermsApprovalRecord[] : [];
  } catch {
    return [];
  }
}

export async function applyApprovedTerms(
  documentRef: Document = document,
  approvals?: TermsApprovalRecord[],
): Promise<TermsApprovalResult[]> {
  const candidates = findTermsAgreementCandidates(documentRef);
  if (!candidates.length) return [];
  const records = approvals || await readTermsApprovals();
  const results: TermsApprovalResult[] = [];

  for (const candidate of candidates) {
    let currentFingerprint: string;
    try {
      currentFingerprint = await fingerprintTermsAgreement(candidate);
    } catch {
      results.push({ candidate, status: "human-review", reason: "The current agreement could not be fingerprinted safely." });
      continue;
    }
    const approval = records.find((record) => record.siteKey === candidate.siteKey && record.agreementKey === candidate.agreementKey);
    if (!isTermsApprovalValid(candidate, currentFingerprint, approval)) {
      results.push({ candidate, status: "human-review", reason: candidate.reason || "No matching authorized approval for the current agreement." });
      continue;
    }

    if (!candidate.checkbox.checked) {
      candidate.checkbox.checked = true;
      candidate.checkbox.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (candidate.checkbox.checked) results.push({ candidate, status: "checked", reason: "Approved agreement fingerprint matched and checkbox state was verified." });
    else results.push({ candidate, status: "human-review", reason: "Approved Terms checkbox did not retain its checked state." });
  }
  return results;
}
