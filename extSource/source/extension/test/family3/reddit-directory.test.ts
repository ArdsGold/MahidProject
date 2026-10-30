import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { createEmptyProfileInput, type BusinessProfile } from "@backlink-autofill/shared";
import { getSiteAdapter } from "../../src/automation/adapters";
import { redditDirectoryAdapter, inspectRedditDirectory } from "../../src/automation/reddit-directory";
import { runListingAutofill, runListingAutofillAsync } from "../../src/content/listing-autofill";
const fixture = readFileSync(new URL("../../family3/fixtures/reddit-directory.html", import.meta.url), "utf8");
const profile: BusinessProfile = { ...createEmptyProfileInput(), id: "sample", businessName: "Example Business", website: "https://example.test/business", contactName: "Example Owner", email: "owner@example.test", description: "Approved sample business description. Never submit.", category: "Web Design", createdAt: "2026-10-18", updatedAt: "2026-10-18" };
function setup(t: TestContext, url = "https://reddit-directory.com/submit.php", html = fixture) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  win.document.write(html);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "document", "location", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event"]) g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  g.chrome = new Proxy({}, { get: () => { throw Error("Native fill-only must not access runs/receipts or send commands"); } });
  const doc = win.document as unknown as Document; let actions = 0;
  doc.addEventListener("click", () => actions++); doc.addEventListener("submit", e => { actions++; e.preventDefault(); });
  for (const form of win.document.forms) for (const method of ["submit", "requestSubmit"]) Object.defineProperty(form, method, { value: () => actions++ });
  t.after(async () => { assert.equal(actions, 0); await win.happyDOM.close(); });
  return { doc, value: (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value };
}
test("Reddit routes exact Add Site label and its observed same-origin target", t => {
  setup(t, "https://reddit-directory.com/", '<a href="/submit.php">Add Site</a>');
  const report = runListingAutofill(profile);
  assert.equal(getSiteAdapter(location.href)?.config.id, "reddit-directory");
  assert.deepEqual(report.entryAction, { label: "Add Site", href: "https://reddit-directory.com/submit.php" });
  assert.equal(report.navigationUrl, "https://reddit-directory.com/submit.php");
  for (const href of ["https://directory3.org/submit.php", "https://groovy-directory.com/submit.php", "http://reddit-directory.com/submit.php", "https://reddit-directory.com.evil.test/submit.php"]) assert.equal(redditDirectoryAdapter.discoverEntry("", [{ text: "Add Site", href }]), null);
});
test("actual Reddit schema fills six fields/current category and leaves listing type/Terms/search unchanged", t => {
  const { doc, value } = setup(t); const radio = doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!;
  doc.body.insertAdjacentHTML("beforeend", '<input name="q" value="Search"><input type="checkbox" name="terms" aria-label="Accept Terms">');
  assert.equal(inspectRedditDirectory(doc, location.href).state, "form"); assert.equal(radio.checked, false);
  const exact = [...doc.querySelector<HTMLSelectElement>('[name=CATEGORY_ID]')!.options].find(o => o.textContent?.trim().endsWith("___Web Design"))!;
  exact.value = "current-reddit-option";
  const report = runListingAutofill(profile); assert.equal(report.filled.length, 6);
  for (const [name, expected] of Object.entries({ TITLE: profile.businessName, URL: profile.website, OWNER_NAME: profile.contactName, OWNER_EMAIL: profile.email, DESCRIPTION: profile.description })) assert.equal(value(name), expected);
  assert.equal(value("CATEGORY_ID"), exact.value); assert.equal(radio.checked, false); assert.equal(radio.value, "normal");
  assert.equal(value("q"), "Search"); assert.equal(doc.querySelector<HTMLInputElement>('[name=terms]')!.checked, false);
  assert(report.manual.some(gate => /LINK_TYPE.*human selection.*unchanged/.test(gate)));
  radio.checked = true; runListingAutofill(profile); assert.equal(radio.checked, true);
  assert.equal(report.liveUrl, undefined); assert.equal(report.form, undefined);
});
for (const change of ["missing", "paid", "duplicate", "text"]) test(`unverified listing-type structure refuses autofill: ${change}`, t => {
  const { doc } = setup(t); const radio = doc.querySelector<HTMLInputElement>('[name=LINK_TYPE]')!;
  if (change === "missing") radio.remove();
  if (change === "paid") radio.value = "featured";
  if (change === "duplicate") radio.after(radio.cloneNode(true));
  if (change === "text") radio.type = "text";
  assert.equal(runListingAutofill(profile).filled.length, 0);
});
test("Reddit unrelated category remains manual despite business text", t => {
  const { value } = setup(t);
  const report = runListingAutofill({ ...profile, category: "zzzzzz", businessName: "Web Design", description: "Web Design" });
  assert.equal(value("CATEGORY_ID"), "0"); assert(!report.filled.some(f => f.field === "category"));
});
test("unknown radio or changed form action still fails closed", t => {
  const { doc } = setup(t); const form = doc.querySelector('form')!;
  form.insertAdjacentHTML("beforeend", '<input type="radio" name="OTHER_TYPE" value="normal">');
  assert.equal(runListingAutofill(profile).filled.length, 0);
  form.querySelector('[name=OTHER_TYPE]')!.remove(); form.action = "https://groovy-directory.com/submit.php";
  assert.equal(runListingAutofill(profile).filled.length, 0);
});
test("Reddit async route reuses native engine without run/receipt access", async t => {
  setup(t); assert.equal((await runListingAutofillAsync(profile)).filled.length, 6);
});
