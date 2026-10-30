import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { expansionDirectoryAdapter, inspectExpansionDirectory } from "../../src/automation/expansion-directory";
import { createNativeDirectoryAdapter, inspectNativeDirectory } from "../../src/automation/native-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";

const fixture = readFileSync(new URL("../../family3/fixtures/expansion-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Safe sample approved description. Never submit.", category: "Cleaning", createdAt: "2026-10-18", updatedAt: "2026-10-18" };
const imageLink = '<a href="/submit.php" title="Submit your link to the directory"><img src="/images/index_06.gif"></a>';
function setup(t: TestContext, url = "https://expansiondirectory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Fill-only route cannot access runs, receipts, authorization or Sheets"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { actions++; e.preventDefault(); });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => actions++ });
  t.after(async () => { assert.equal(actions, 0); await win.happyDOM.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}

for (const footer of ["", '<a href="/submit.php">Submit Link</a>']) test(`Expansion image-title navigation resolves exact observed same-origin form, footer=${!!footer}`, t => {
  setup(t, "https://expansiondirectory.com/", imageLink + footer);
  assert.equal(getSiteAdapter(location.href)?.config.id, "expansion-directory");
  const report = runListingAutofill(profile);
  assert.deepEqual(report.entryAction, { label: "Submit your link to the directory", href: "https://expansiondirectory.com/submit.php" });
  assert.equal(report.filled.length, 0);
});

test("Expansion fills six core fields with current service-matched options, preserving reciprocal/Terms/CAPTCHA/search", t => {
  const { doc, value } = setup(t);
  assert.equal(inspectExpansionDirectory(doc, location.href).state, "form");
  const form = doc.querySelector('[name=TITLE]')!.closest('form')!;
  form.insertAdjacentHTML("beforeend", '<input type="checkbox" name="terms" aria-label="Accept Terms"><textarea name="g-recaptcha-response">human-token-unchanged</textarea>');
  const untouched = ["RECPR_URL", "RECPR_TEXT", "g-recaptcha-response", "q"].map(name => [name, value(name)]);
  const select = doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!;
  assert.equal(select.options.length, 689);
  const cleaning = [...select.options].find(o => o.textContent?.trim().endsWith("___Cleaning"))!;
  cleaning.value = "current-service-option-not-16";
  const report = runListingAutofill(profile);
  assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, DESCRIPTION: profile.description, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email })) assert.equal(value(name), expected);
  assert.equal(value("CATEGORY_ID"), cleaning.value);
  for (const [name, original] of untouched) assert.equal(value(name), original);
  assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  assert.equal(report.liveUrl, undefined); assert.equal(report.form, undefined);
});

test("Expansion category uses only approved category/services and never recorded16 or incidental business text", t => {
  const { value } = setup(t);
  const noMatch = runListingAutofill({ ...profile, category: "zzzzzz", services: [], businessName: "Cleaning", description: "Cleaning" });
  assert.equal(value("CATEGORY_ID"), "0"); assert(!noMatch.filled.some(f => f.field === "category"));
  const matched = runListingAutofill({ ...profile, category: "", services: ["Cleaning"] });
  assert(matched.filled.some(f => f.field === "category")); assert.notEqual(value("CATEGORY_ID"), "16");
});

test("Expansion validates missing/invalid business values without any final action", t => {
  const { value } = setup(t);
  const report = runListingAutofill({ ...profile, businessName: "", website: "not-a-url", email: "not-an-email", contactName: "x".repeat(256) });
  for (const name of ["TITLE", "URL", "OWNER_EMAIL", "OWNER_NAME"]) assert.equal(value(name), "");
  assert(report.skipped.length >= 4);
});

for (const change of ["missing-email", "upload", "foreign-action", "changed-submit"]) test(`Expansion changed structures stop before filling: ${change}`, t => {
  const { doc } = setup(t); const form = doc.querySelector('[name=TITLE]')!.closest('form')!;
  if (change === "missing-email") form.querySelector('[name=OWNER_EMAIL]')!.remove();
  if (change === "upload") form.insertAdjacentHTML("beforeend", '<input type="file" name="upload">');
  if (change === "foreign-action") form.action = "https://directory3.org/submit.php";
  if (change === "changed-submit") form.querySelector<HTMLInputElement>('[name=submit]')!.value = "Submit";
  assert.equal(runListingAutofill(profile).filled.length, 0);
});

test("Expansion rejects forged/ambiguous image navigation and unsupported origins", t => {
  const { doc } = setup(t, "https://expansiondirectory.com/", imageLink.replace('/submit.php', 'https://directory3.org/submit.php'));
  assert.equal(runListingAutofill(profile).navigationUrl, undefined);
  doc.body.innerHTML = imageLink + '<a href="/submit.php?c=1">Submit Link</a>';
  assert.equal(runListingAutofill(profile).navigationUrl, undefined);
  for (const href of ["http://expansiondirectory.com/submit.php", "https://expansiondirectory.com.evil.test/submit.php", "https://user:pass@expansiondirectory.com/submit.php"]) assert.equal(expansionDirectoryAdapter.discoverEntry("", [{ text: "Submit your link to the directory", href }]), null);
});

test("Expansion async route uses the same native engine without generic/storage side effects", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
});

for (const domain of ["bluebook-directory.com", "aurora-directory.com", "fruity-directory.com", "greenydirectory.com"]) test(`F04 captured controls support native inspector reuse with explicit per-domain registration: ${domain}`, t => {
  const page = JSON.parse(readFileSync(new URL(`../../../../docs/family3/structure-audit/${domain}/page-1.json`, import.meta.url), "utf8"));
  const form = page.forms.find((f: { role: string }) => f.role === "native-six-field-listing");
  const html = readFileSync(new URL(`../../../../docs/family3/structure-audit/${domain}/page-1-form-${form.index}.html`, import.meta.url), "utf8");
  const { doc } = setup(t, `https://${domain}/submit.php`, html);
  const site = { id: "candidate", domain, name: domain, startingUrl: `https://${domain}/`, protocols: ["https:"], entryLabels: [domain === "bluebook-directory.com" ? "Submit" : "Submit Link"] };
  assert.equal(inspectNativeDirectory(doc, location.href, site).state, "form");
  assert(createNativeDirectoryAdapter(site).discoverEntry("", [{ text: site.entryLabels[0], href: location.href }]));
  assert.equal(getSiteAdapter(location.href)?.config.id, domain === "greenydirectory.com" ? "greeny-directory" : domain.replace(".com", ""), "Each domain was explicitly integrated from its own evidence");
});
