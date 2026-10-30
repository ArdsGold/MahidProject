import { getGoogleSheetsAccessToken } from "./google-credentials.mjs";

export const AMP_BLOGS_SHEET_ID = "10hF_Ksct-pfMJKlUJp7GmfREnRLmJapDiGhB9E0RuQo";
export const AMP_BLOGS_SHEET_NAME = "Sheet1";
export const AMP_BLOGS_ROW_NUMBER = 18;
export const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const LISTING_FIRST_ROW = 17;

export function normalizeListingDomain(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !url.hostname.includes(".")) return "";
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return ""; }
}

export function findListingSheetRow(values, websiteUrl, liveUrl) {
  const domain = normalizeListingDomain(websiteUrl);
  if (!domain || !liveUrl) return { status: "blocked", code: "invalid-listing", reason: "Listing domain and verified public URL are required." };
  const matches = (Array.isArray(values) ? values : []).map((row, index) => ({ row, rowNumber: LISTING_FIRST_ROW + index }))
    .filter(({ row }) => Array.isArray(row) && normalizeListingDomain(row[0]) === domain);
  if (matches.length !== 1) return { status: "blocked", code: matches.length ? "multiple-domain-matches" : "no-domain-match", reason: "Column A must contain exactly one matching publisher domain from row 17 onward." };
  const { row, rowNumber } = matches[0];
  const range = `${AMP_BLOGS_SHEET_NAME}!B${rowNumber}`;
  if (row[1] !== undefined && row[1] !== "" && row[1] !== liveUrl) return { status: "conflict", code: "existing-url-conflict", reason: "Column B already contains a different value. Inspect the sheet; nothing was overwritten.", rowNumber, range };
  return { status: row[1] === liveUrl ? "already-recorded" : "ready", rowNumber, range };
}

// Shared by the existing client and the Next.js server. No browser/token handoff.
export async function writeVerifiedListingToSheet(input, {
  accessToken = process.env.BA2_GOOGLE_SHEETS_ACCESS_TOKEN,
  writeApproved = process.env.BA2_SHEETS_WRITE_APPROVED === "true",
  prepareOnly = false,
  fetchImpl = fetch,
} = {}) {
  const blocked = (code, reason) => ({ status: "blocked", code, reason });
  const recent = () => Number.isFinite(Date.parse(input?.verification?.checkedAt)) && Date.now() - Date.parse(input.verification.checkedAt) <= 60_000
    && Date.parse(input.verification.checkedAt) <= Date.now() + 5_000;
  if (input?.publicationAuthorized !== true || input?.verification?.status !== "verified" || !input?.liveUrl
    || input.verification.url !== input.liveUrl || !normalizeListingDomain(input.websiteUrl) || !recent()) return blocked("unverified-listing", "Only an authorized publication with a current verified exact public URL can be synchronized.");
  if (!prepareOnly && !writeApproved) return blocked("write-approval-required", "Operator approval for the Google Sheets write scope is required. No write attempted.");
  accessToken ??= await getGoogleSheetsAccessToken();
  if (!accessToken) return blocked("sheets-authorization-missing", "A server-side Google OAuth access token is required.");
  let writeStarted = false;
  let selected;
  const request = async (url, init = {}) => {
    const response = await fetchImpl(url, { ...init, credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...init.headers } });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "authorization" : "request");
    return response.json();
  };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${AMP_BLOGS_SHEET_ID}/values/`;
  const read = range => request(`${base}${encodeURIComponent(range)}?valueRenderOption=FORMULA`, { method: "GET" });
  try {
    // Same token-info request as Google's OAuth client: token only in Authorization.
    if (!prepareOnly) {
      const info = await request("https://oauth2.googleapis.com/tokeninfo", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } });
      if (typeof info.scope !== "string" || !info.scope.split(/\s+/).includes(SHEETS_WRITE_SCOPE) || !Number.isFinite(Number(info.expires_in)) || Number(info.expires_in) <= 0)
        return blocked("write-scope-required", "Google OAuth has not granted the required Sheets write scope. Read-only authorization cannot write.");
    }
    const scan = async () => findListingSheetRow((await read(`${AMP_BLOGS_SHEET_NAME}!A${LISTING_FIRST_ROW}:B`)).values, input.websiteUrl, input.liveUrl);
    selected = await scan();
    // Preparation shares the exact original domain/cell resolver, but returns
    // before the mutation path even when global write approval is enabled.
    if (prepareOnly) return { ...selected, code: selected.code || "cell-prepared", readBackConfirmed: selected.status === "already-recorded" };
    if (!["ready", "already-recorded"].includes(selected.status)) return selected;
    // Re-resolve by domain just before mutation, rather than trusting an old row.
    const fresh = await scan();
    if (!["ready", "already-recorded"].includes(fresh.status)) return fresh;
    selected = fresh;
    const alreadyRecorded = selected.status === "already-recorded";
    if (!alreadyRecorded) {
      if (!recent()) return blocked("verification-expired", "Article verification expired while waiting. No write attempted.");
      writeStarted = true;
      await request(`${base}${encodeURIComponent(selected.range)}?valueInputOption=RAW`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ range: selected.range, majorDimension: "ROWS", values: [[input.liveUrl]] }),
      });
    }
    const saved = await read(`${AMP_BLOGS_SHEET_NAME}!A${selected.rowNumber}:B${selected.rowNumber}`);
    const row = saved.values?.[0];
    if (!Array.isArray(row) || normalizeListingDomain(row[0]) !== normalizeListingDomain(input.websiteUrl) || row[1] !== input.liveUrl)
      return { status: "uncertain", code: "read-back-mismatch", reason: "The publisher row and saved URL could not be confirmed. Inspect the sheet; no automatic retry.", rowNumber: selected.rowNumber, range: selected.range, readBackConfirmed: false };
    const confirmed = await scan();
    if (confirmed.status !== "already-recorded" || confirmed.rowNumber !== selected.rowNumber)
      return { status: "uncertain", code: "row-changed", reason: "The domain mapping changed during synchronization. Inspect the sheet; no automatic retry.", readBackConfirmed: false };
    return { status: alreadyRecorded ? "already-recorded" : "recorded", code: "cell-confirmed", reason: "The exact public URL was confirmed in the matching publisher's column B cell.", rowNumber: selected.rowNumber, range: selected.range, readBackConfirmed: true };
  } catch {
    return { status: writeStarted ? "uncertain" : "blocked", code: writeStarted ? "write-outcome-unknown" : "sheets-request-failed",
      reason: writeStarted ? "Write/read-back was interrupted. Inspect the sheet; no automatic retry." : "Google authorization or sheet read failed. No write was attempted.", readBackConfirmed: false };
  }
}

const AMP_BLOGS_HOST = "ampblogs.com";

function host(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function validateAmpBlogsSheetRow(values) {
  const row = Array.isArray(values) ? values.slice(0, 3).map((value) => typeof value === "string" ? value.trim() : "") : [];
  const [directoryUrl = "", existingListingUrl = "", existingStatus = ""] = row;
  if (!directoryUrl || host(directoryUrl) !== AMP_BLOGS_HOST) {
    return { ok: false, code: "row-mismatch", reason: "Sheet row does not identify ampblogs.com." };
  }
  if (existingListingUrl && !validHttpUrl(existingListingUrl)) {
    return { ok: false, code: "invalid-existing-url", reason: "Existing listing URL is not a valid HTTP(S) URL." };
  }
  return {
    ok: true,
    row: {
      directoryUrl: validHttpUrl(directoryUrl),
      existingListingUrl: existingListingUrl ? validHttpUrl(existingListingUrl) : "",
      existingStatus,
    },
  };
}

export async function readAmpBlogsSheet({ accessToken = process.env.BA2_GOOGLE_SHEETS_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  accessToken ??= await getGoogleSheetsAccessToken();
  if (!accessToken) {
    return {
      status: "blocked",
      code: "sheets-authorization-missing",
      reason: "Google Sheets authorization is not configured.",
      setupPlan: [
        "Create or authorize a Google OAuth access token with read access to the target spreadsheet.",
        "Provide it to the worker as BA2_GOOGLE_SHEETS_ACCESS_TOKEN or replace this client with an OAuth refresh-token provider.",
        "Keep tokens outside source control, workflow state, logs, and browser pages.",
      ],
    };
  }

  const range = encodeURIComponent(`${AMP_BLOGS_SHEET_NAME}!A${AMP_BLOGS_ROW_NUMBER}:C${AMP_BLOGS_ROW_NUMBER}`);
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${AMP_BLOGS_SHEET_ID}/values/${range}`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
  } catch {
    return { status: "blocked", code: "sheets-network", reason: "Google Sheets read failed; check the connection." };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "blocked", code: "sheets-authorization-rejected", reason: "Google Sheets authorization was rejected or lacks access to the target document." };
  }
  if (!response.ok) return { status: "failed", code: "sheets-read-failed", reason: `Google Sheets returned HTTP ${response.status}.` };
  let payload;
  try { payload = await response.json(); } catch { return { status: "failed", code: "sheets-invalid-response", reason: "Google Sheets returned invalid JSON." }; }
  const result = validateAmpBlogsSheetRow(payload?.values?.[0]);
  return result.ok ? { status: "ready", ...result } : { status: "blocked", ...result };
}
