import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { jetLinksAdapter, jetLinksSite, inspectJetLinks } from "../../src/automation/jet-links";
import { inspectNativeDirectory } from "../../src/automation/native-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/jet-links.com.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Test Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample approved description. Never submit.", category: "Web Design and Development", createdAt: "2026-10-18", updatedAt: "2026-10-18" };
function setup(t: TestContext, url = "https://jet-links.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } }); win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Jet fill-only cannot access runs/receipts/authorization/Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { actions++; e.preventDefault(); });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => actions++ });
  t.after(async () => { assert.equal(actions, 0); await win.happyDOM.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

test("Jet actual Add Site resolves only same-origin verified form", t => {
  setup(t, jetLinksSite.startingUrl, '<a href="/submit.php">Add Site</a>');
  assert.equal(getSiteAdapter(location.href)?.config.id, "jet-links");
  assert.deepEqual(runListingAutofill(profile).entryAction, { label: "Add Site", href: "https://jet-links.com/submit.php" });
  for (const href of ["http://jet-links.com/submit.php", "https://adbritedirectory.com/submit.php", "https://jet-links.com.evil.test/submit.php"]) assert.equal(jetLinksAdapter.discoverEntry("", [{ text: "Add Site", href }]), null);
});

for (const checked of [false, true]) test(`Jet six core fields/current category; Terms state=${checked} and all actions untouched`, t => {
  const { doc, value } = setup(t); const checkbox = doc.querySelector<HTMLInputElement>('[name=agree]')!;
  checkbox.checked = checked;
  Object.defineProperty(checkbox, "checked", { configurable: true, get: () => checked, set: () => { throw Error("Never write or replay Terms checkbox state"); } });
  assert.equal(inspectJetLinks(doc, location.href).state, "form");
  assert.equal(value("agree"), "0"); assert.match(checkbox.parentElement!.textContent!, /Accept Terms of Agreement/);
  doc.body.insertAdjacentHTML("beforeend", '<input name="q" value="Search"><input name="RECPR_URL" value="unchanged"><textarea name="RECPR_TEXT">unchanged</textarea>');
  doc.querySelector('form')!.insertAdjacentHTML("beforeend", '<textarea name="g-recaptcha-response">human-token-unchanged</textarea>');
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!; assert.equal(select.options.length, 541);
  const option = [...select.options].find(o => o.textContent?.includes("Web Design and Development"))!; option.value = "current-jet-category";
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  assert.equal(value("CATEGORY_ID"), option.value); assert.equal(checkbox.checked, checked);
  for (const name of ["RECPR_URL", "RECPR_TEXT"]) assert.equal(value(name), "unchanged");
  assert.equal(value("q"), "Search"); assert.equal(value("g-recaptcha-response"), "human-token-unchanged");
  assert(report.manual.some(m => /Accept Terms of Agreement.*human acceptance.*unchanged/.test(m)));
  assert(report.manual.some(m => /Exit.*never clicked/.test(m))); assert.equal(report.form, undefined); assert.equal(report.liveUrl, undefined);
});

test("Jet categories require approved category/services, not incidental description", t => {
  const { value } = setup(t);
  const unknown = runListingAutofill({ ...profile, category: "zzzzzz", services: [], businessName: profile.category, description: profile.category });
  assert.equal(value("CATEGORY_ID"), "0"); assert(!unknown.filled.some(f => f.field === "category"));
  assert(runListingAutofill({ ...profile, category: "", services: [profile.category] }).filled.some(f => f.field === "category"));
});

for (const change of ["missing", "duplicate", "type", "value", "disabled", "hidden", "label", "rules-origin", "extra-checkbox"]) test(`Jet changed Terms contract refuses fill: ${change}`, t => {
  const { doc } = setup(t); const checkbox = doc.querySelector<HTMLInputElement>('[name=agree]')!;
  if (change === "missing") checkbox.remove();
  if (change === "duplicate") checkbox.after(checkbox.cloneNode(true));
  if (change === "type") checkbox.type = "text";
  if (change === "value") checkbox.value = "1";
  if (change === "disabled") checkbox.disabled = true;
  if (change === "hidden") checkbox.hidden = true;
  if (change === "label") checkbox.parentElement!.querySelector('a')!.textContent = "Unverified purpose";
  if (change === "rules-origin") checkbox.parentElement!.querySelector('a')!.href = "https://example.test/rules.php";
  if (change === "extra-checkbox") checkbox.insertAdjacentHTML("afterend", '<input type="checkbox" name="extra-consent">');
  assert.equal(runListingAutofill(profile).filled.length, 0);
});

for (const change of ["missing", "duplicate", "value", "name", "disabled", "extra-button"]) test(`Jet changed Exit contract refuses fill: ${change}`, t => {
  const { doc } = setup(t); const exit = doc.querySelector<HTMLInputElement>('input[type=button]')!;
  if (change === "missing") exit.remove();
  if (change === "duplicate") exit.after(exit.cloneNode(true));
  if (change === "value") exit.value = "Pay";
  if (change === "name") exit.name = "unverified";
  if (change === "disabled") exit.disabled = true;
  if (change === "extra-button") exit.insertAdjacentHTML("afterend", '<button type="button">Unverified</button>');
  assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("F07 manual Exit allowance is opt-in; default unknown-control guard retained", t => {
  const { doc } = setup(t); const { manualTerms: _manual, ...unconfigured } = jetLinksSite;
  assert.equal(inspectNativeDirectory(doc, location.href, unconfigured).state, "unsupported");
  doc.querySelector('form')!.insertAdjacentHTML("beforeend", '<input type="file" name="upload">');
  assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Jet business validation and foreign form action still refuse invalid data", t => {
  const { doc, value } = setup(t);
  const report = runListingAutofill({ ...profile, businessName: "", website: "invalid", email: "invalid" });
  assert(report.skipped.length >= 3); for (const name of ["TITLE", "URL", "OWNER_EMAIL"]) assert.equal(value(name), "");
  doc.querySelector('form')!.action = "https://directory3.org/submit.php"; assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Jet async route uses existing native mapper without storage or generic fallback", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
});

test("Adbrite verified HTTP support stays in its own adapter; Jet remains HTTPS-only", t => {
  const html = readFileSync(new URL("../../family3/fixtures/adbritedirectory.com.html", import.meta.url), "utf8");
  const { doc } = setup(t, "http://adbritedirectory.com/submit.php", html);
  const candidate = { ...jetLinksSite, id: "candidate-only", domain: "adbritedirectory.com", startingUrl: "http://adbritedirectory.com/", protocols: ["http:"] };
  assert.equal(inspectNativeDirectory(doc, location.href, candidate).state, "form");
  assert.equal(doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.options.length, 689);
  assert.equal(getSiteAdapter("http://adbritedirectory.com/")?.config.id, "adbrite-directory");
  assert.equal(getSiteAdapter("http://jet-links.com/"), null);
  assert.equal(getSiteAdapter("https://www.adbritedirectory.com/")?.config.id, "adbrite-directory");
  assert.equal(jetLinksAdapter.matches(location.href), false);
});
