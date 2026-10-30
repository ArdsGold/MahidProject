import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";
import { createEmptyProfileInput, EXCLUDED_AUTOMATION_HOSTS, isAutomationExcluded, type BusinessProfile } from "@backlink-autofill/shared";
import { runAutofill } from "../../src/content/autofill";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";
import { installFloatingAutofillButton } from "../../src/content/floating-button";
import { getSiteAdapter } from "../../src/automation/adapters";

const host = EXCLUDED_AUTOMATION_HOSTS[0];
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "shared-example", businessName: "Example Business", email: "owner@example.test", website: "https://example.test/", description: "Approved description", createdAt: "2026-10-19", updatedAt: "2026-10-19" };
function setup(t: TestContext, url: string) {
  const win = new Window({ url }); win.document.write('<form><label>Business Name<input name="businessName"></label><label>Email<input type="email" name="email"></label><label>Password<input type="password" name="password"></label><input type="file"><input type="checkbox"><select><option value="">Choose</option><option value="match">Business</option></select><button>Submit</button></form>');
  const globals = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Event", "Element"]) globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  globals.chrome = new Proxy({}, { get() { throw Error("Excluded-page mapping cannot access profiles/assets/runs or receipts"); } });
  t.after(() => win.close()); return win.document;
}
test("exclusion policy blocks retired hosts and subdomains without matching unrelated lookalikes", () => {
  for (const url of [host, `http://${host}/`, `https://www.${host}/submit`, `https://members.${host}/`, `https://${host.toUpperCase()}./`, `http://${host}:8080/`]) assert.equal(isAutomationExcluded(url), true, url);
  for (const url of ["https://directory3.org/", "https://groovy-directory.com/", `https://${host}.example.test/`, `https://not${host}/`, "", undefined]) assert.equal(isAutomationExcluded(url), false, String(url));
});
test("generic sync/async autofill cannot touch fields, trigger navigation or expose assets on excluded pages", async t => {
  for (const scheme of ["http", "https"]) {
    const doc = setup(t, `${scheme}://www.${host}/`); const before = doc.body.innerHTML; let actions = 0;
    for (const event of ["input", "change", "click", "submit"]) doc.addEventListener(event, () => actions++);
    assert.equal(runAutofill(profile).filled.length, 0);
    for (const report of [runListingAutofill(profile), await runListingAutofillAsync(profile)]) { assert.equal(report.filled.length, 0); assert.equal(report.navigationUrl, undefined); assert.equal(report.form, undefined); assert.match(report.manual.join(" "), /excluded/); }
    assert.equal(installFloatingAutofillButton(), null); assert.equal(getSiteAdapter(location.href), null);
    assert.equal(doc.body.innerHTML, before); assert.equal(actions, 0);
  }
});
test("excluded destinations are absent from the active inventory and matrix, with all other site records preserved", () => {
  const load = (path: string) => JSON.parse(readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8"));
  const inventory = load("docs/family3/inventory.json"), matrix = load("docs/family3/structure-audit/matrix.json"), sheet = load("docs/family3/structure-audit/sheet-reconciliation.json");
  assert.equal(inventory.count, 29); assert.equal(matrix.totals.inventory, 29); assert.equal(matrix.groups.length, 8);
  for (const site of [...inventory.sites, ...matrix.sites]) assert.equal(isAutomationExcluded(site.domain), false);
  assert.deepEqual(inventory.sites.map((site: { row: number }) => site.row), sheet.rows.filter((site: { website: string }) => !isAutomationExcluded(site.website)).map((site: { row: number }) => site.row));
});
test("built workers reject new excluded runs and leave historical runs/receipts unchanged on recovery and navigation events", async () => {
  for (const source of [`https://${host}/`, "https://groovy-directory.com/"]) {
  const stored = { "ba2.activeProfile": { profile, syncedAt: "offline", source: "local-storage" }, "ba2.listingRun": { id: "retained-old-run", domain: new URL(source).hostname, sourceUrl: source, profileId: profile.id, tabId: 71, stage: "NAVIGATING", navigationTarget: source + "old-path", steps: [], manual: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, "ba2.cargo.runs": { preserved: { receipt: "claimed", outcome: "uncertain" } } } as Record<string, unknown>;
  const before = JSON.stringify(stored); let receiver: Function | undefined, updated: Function | undefined;
  const chrome = { runtime: { id: "offline", getURL: (path: string) => "chrome-extension://offline/" + path, getManifest: () => ({version:"fixture"}), onInstalled: { addListener() {} }, onMessage: { addListener(fn: Function) { receiver = fn; } } }, storage: { local: { get: async (key: string) => ({ [key]: stored[key] }), set: async () => { throw Error("History must not change"); }, remove: async () => { throw Error("History must not be removed"); } } }, tabs: { onRemoved: {addListener(){}}, onReplaced: {addListener(){}}, query: async () => [{ id: 71, url: `https://${host}/` }], onUpdated: { addListener(fn: Function) { updated = fn; } }, get: async () => ({ id: 71, url: `https://${host}/` }), sendMessage: async () => { throw Error("No autofill dispatch"); }, update: async () => { throw Error("No excluded navigation"); } } };
  const script = readFileSync(new URL("../../../dist/background.js", import.meta.url), "utf8");
  vm.runInNewContext(script, { chrome, console, URL, crypto, TextEncoder, setTimeout, clearTimeout, structuredClone });
  const response = await new Promise<{ ok: boolean; error: string }>(resolve => receiver!({ type: "BA2_START_LISTING_AUTOFILL" }, {}, resolve));
  assert.equal(response.ok, false); assert.match(response.error, /excluded/);
  updated!(71, { status: "complete", url: `https://${host}/` });
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(JSON.stringify(stored), before);
  }
});
test("built extension contains no retired workflow receivers, selectors or asset placeholders", () => {
  for (const path of ["background.js", "content/content.js", "popup/popup.js"]) {
    const text = readFileSync(new URL(`../../../dist/${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /BA2_CARGO_|#link210|MAHID_SAVED_ASSET_PATH/);
  }
});
