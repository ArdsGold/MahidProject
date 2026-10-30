import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { getCities, getStates, withCountrySelection, withGatheredLocation, withStateSelection } from "../web/src/lib/location-data.ts";
import { createEmptyProfileInput, formatBusinessAddress, normalizeBusinessProfile } from "../shared/src/business-profile.ts";
import { normalizeSourceSnapshot } from "../shared/src/source-capture.ts";
import { createCaptureJob, normalizeCaptureJob } from "../shared/src/capture-job.ts";
import { addSocialLink, createAssetRef, descriptionHtmlForEditor, descriptionHtmlFromClipboard, descriptionPlainText, detectSocialPlatform, isSupportedSocialUrl, validateBrochureFile, validateLogoFile } from "../web/src/lib/profile-editor-logic.ts";
import { composeGatherResult, extractSnapshot, generateShortDescription, isBrowserChallengeResponse, rankInternalLinks, validateSourceUrl } from "../web/src/lib/source-gatherer.ts";
import { mergeBrowserSourceIntoDraft } from "../web/src/lib/source-capture-merge.ts";
import { createLocalStorageProfileRepository } from "../web/src/lib/local-storage-repository.ts";

globalThis.DOMParser = new Window().DOMParser;

test("pasted Google Docs hypertext keeps the visible words and exact href", () => {
  const googleDocs = `<meta charset="utf-8"><b id="docs-internal-guid-1" style="font-weight:normal;"><p dir="ltr" style="line-height:1.38;"><span style="font-size:11pt;">Morgan Hill Junk Removal</span><span style="font-size:11pt;"> — </span><a href="https://example.com/morgan-hill-junk-removal/" style="text-decoration:none;"><span style="font-size:11pt;">Morgan Hill Junk Removal</span></a></p><p dir="ltr" style="line-height:1.38;"><span style="font-size:11pt;">Fast local hauling.</span></p></b>`;
  const html = descriptionHtmlFromClipboard(googleDocs);
  assert.equal(html, `<p>Morgan Hill Junk Removal — <a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p><p>Fast local hauling.</p>`);
  assert.equal(html.includes(">https://example.com/morgan-hill-junk-removal/<"), false, "the raw URL must not replace the visible words");
  assert.equal((html.match(/<a href=/g) || []).length, 1, "only the linked text becomes an anchor");
});

test("pasted plain text is preserved without inventing links", () => {
  const html = descriptionHtmlFromClipboard(`<p>Morgan Hill Junk Removal</p><p>Call us today.</p>`);
  assert.equal(html, `<p>Morgan Hill Junk Removal</p><p>Call us today.</p>`);
  assert.equal(html.includes("<a "), false, "unlinked text must not become a link");
});

test("pasted hypertext preserves inline line breaks and blank-line paragraphs", () => {
  const html = descriptionHtmlFromClipboard(`<p>Line one<br>Line two</p><p><br></p><p>Second paragraph <a href="https://example.com/page">linked words</a></p>`);
  assert.equal(html, `<p>Line one<br>Line two</p><p><br></p><p>Second paragraph <a href="https://example.com/page">linked words</a></p>`);
});

test("dashboard Long Description renders hypertext instead of raw HTML", () => {
  const stored = `<p>Morgan Hill Junk Removal</p><p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p>`;
  const editorHtml = descriptionHtmlForEditor(stored);
  assert.equal(editorHtml, stored, "stored HTML must render as HTML, not escaped text");
  assert.equal(editorHtml.includes("&lt;a"), false, "raw anchor tags must not be shown as visible text");
  assert.equal(descriptionHtmlForEditor("Line one\n\nLine two"), "<p>Line one</p><p>Line two</p>", "plain text becomes readable paragraphs");
});

test("hybrid plain text + HTML anchors preserve spacing and links in rich output", () => {
  const stored = `Some plain text\n\n<p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p>\n\nMore plain text`;
  const rich = descriptionHtmlForEditor(stored);
  assert.equal(rich, `<p>Some plain text</p><p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p><p>More plain text</p>`, "hybrid content must wrap plain text in <p> and preserve HTML blocks");
  assert.equal(rich.includes('href="https://example.com/morgan-hill-junk-removal/"'), true, "anchor href must be preserved");
  assert.equal(rich.includes("Morgan Hill Junk Removal"), true, "visible anchor text must be preserved");
});

test("plain text output strips HTML tags but keeps visible anchor text and line breaks", () => {
  const stored = `<p>Morgan Hill Junk Removal</p><p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p>`;
  const plain = descriptionPlainText(stored);
  assert.equal(plain, "Morgan Hill Junk Removal\n\nMorgan Hill Junk Removal", "plain output must strip tags and preserve paragraph breaks");
  assert.equal(plain.includes("<p>"), false, "no <p> tags in plain output");
  assert.equal(plain.includes("<a "), false, "no <a> tags in plain output");
  assert.equal(plain.includes("href"), false, "no href in plain output");
  assert.equal(descriptionPlainText("Line one\n\nLine two"), "Line one\n\nLine two", "plain text stays as-is");
  assert.equal(descriptionPlainText(`<p>Line one<br>Line two</p>`), "Line one\nLine two", "br becomes newline in plain output");
});

test("saved rich-text Long Description preserves hypertext href on reopen", async () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } };
  try {
    const repository = createLocalStorageProfileRepository();
    const description = `<p>Morgan Hill Junk Removal</p><p><a href="https://example.com/morgan-hill-junk-removal/">Morgan Hill Junk Removal</a></p>`;
    const saved = await repository.create({ ...createEmptyProfileInput(), businessName: "Morgan Hill Junk Removal", description });
    const reopened = await repository.get(saved.id);
    assert.equal(reopened?.description, description, "reopened description must keep the same hypertext HTML");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("browser SourceSnapshot validation is bounded and rejects generic Google facts", () => {
  const snapshot = normalizeSourceSnapshot({ sourceType: "website", sourceUrl: "https://example.com/", capturedAt: new Date().toISOString(), facts: { businessName: "Google Maps", services: Array.from({ length: 12 }, (_, index) => `Service ${index}`) }, internalLinks: Array.from({ length: 14 }, (_, index) => ({ label: `Page ${index}`, url: `https://example.com/page-${index}#section`, type: "fallback" })) });
  assert.ok(snapshot);
  assert.equal(snapshot.facts.businessName, undefined);
  assert.equal(snapshot.facts.services.length, 10);
  assert.equal(snapshot.internalLinks.length, 12);
  assert.equal(normalizeSourceSnapshot({ sourceType: "website", sourceUrl: "javascript:alert(1)", capturedAt: "now", facts: {}, internalLinks: [] }), null);
});

test("capture jobs persist request identity and terminal snapshot state", () => {
  const requested = createCaptureJob("job-1", "website", "https://example.com/");
  assert.equal(requested.status, "requested");
  const stored = normalizeCaptureJob({ ...requested, status: "success", message: "SourceSnapshot stored", matchedTabUrl: "https://www.example.com/", snapshot: { sourceType: "website", sourceUrl: "https://example.com/", capturedAt: new Date().toISOString(), facts: { businessName: "Example" }, internalLinks: [] } });
  assert.equal(stored?.id, "job-1");
  assert.equal(stored?.status, "success");
  assert.equal(stored?.matchedTabUrl, "https://www.example.com/");
  assert.equal(stored?.snapshot?.facts.businessName, "Example");
});

test("browser website capture merges detail without overriding existing GBP core facts", () => {
  const draft = { ...createEmptyProfileInput(), businessName: "GBP Name", phone: "111", email: "manual@example.com", logoAsset: { id: "logo", fileName: "logo.png", mimeType: "image/png", size: 1 }, brochureAsset: { id: "brochure", fileName: "brochure.pdf", mimeType: "application/pdf", size: 1 }, description: "Old", services: ["Old service"] };
  const merged = mergeBrowserSourceIntoDraft(draft, { sourceType: "website", sourceUrl: "https://example.com", capturedAt: new Date().toISOString(), facts: { businessName: "Website Name", phone: "222", email: "hello@example.com", description: "Rendered source detail", services: ["Real service"] }, internalLinks: [] });
  assert.ok(merged);
  assert.equal(merged.businessName, "GBP Name");
  assert.equal(merged.phone, "111");
  assert.equal(merged.email, "manual@example.com", "Submission Email must remain manual");
  assert.equal(merged.logoAsset?.id, "logo");
  assert.equal(merged.brochureAsset?.id, "brochure");
  assert.deepEqual(merged.services, ["Real service"]);
});

test("browser website capture hydrates location, services, hours, links, and a bounded short description", () => {
  const merged = mergeBrowserSourceIntoDraft(createEmptyProfileInput(), { sourceType: "website", sourceUrl: "https://example.com", capturedAt: new Date().toISOString(), facts: { businessName: "Precision Surveying & Consulting", email: "info@precisionsurvey.tech", phone: "(402) 278-1666", address: "3803 North 153rd Street Suite 100-101", city: "Omaha", state: "NE", postalCode: "68116", country: "US", description: "Precision Surveying & Consulting provides land surveying and construction support for commercial projects." , services: ["Construction Staking", "As-Builting"], businessHours: ["Monday: 7:00 AM - 5:00 PM"] }, internalLinks: [{ label: "Data Center Surveying", url: "https://example.com/data-center-surveying", type: "commercial" }] });
  assert.ok(merged);
  assert.equal(merged.businessName, "Precision Surveying & Consulting");
  assert.equal(merged.address, "3803 North 153rd Street Suite 100-101");
  assert.deepEqual(merged.services, ["Construction Staking", "As-Builting"]);
  assert.deepEqual(merged.businessHours, ["Monday: 7:00 AM - 5:00 PM"]);
  assert.equal(merged.internalLinks[0].label, "Data Center Surveying");
  assert.ok(merged.shortDescription.length <= 160);
});

test("SiteGround challenge evidence requires browser capture, while generic 202 does not", () => {
  assert.equal(isBrowserChallengeResponse(202, "<html><body><script>sgcaptcha</script></body></html>"), true);
  assert.equal(isBrowserChallengeResponse(202, "<html><body><h1>Real business</h1><main>Meaningful content</main></body></html>"), false);
  assert.equal(isBrowserChallengeResponse(200, "<html><body><h1>Verify you are human</h1></body></html>"), true);
});

test("country selection resets state and city and changes state options", () => {
  const draft = { ...createEmptyProfileInput(), country: "United States", countryCode: "US", state: "Nebraska", stateCode: "NE", city: "Omaha" };
  const changed = withCountrySelection(draft, "CA");
  assert.equal(changed.countryCode, "CA");
  assert.equal(changed.stateCode, "");
  assert.equal(changed.state, "");
  assert.equal(changed.city, "");
  assert.notDeepEqual(getStates("US").map((state) => state.isoCode), getStates("CA").map((state) => state.isoCode));
});

test("state selection resets city and city options depend on state", () => {
  const draft = { ...createEmptyProfileInput(), countryCode: "US", country: "United States", stateCode: "NE", state: "Nebraska", city: "Omaha" };
  const changed = withStateSelection(draft, "US", "CA");
  assert.equal(changed.stateCode, "CA");
  assert.equal(changed.city, "");
  assert.ok(getCities("US", "NE").some((city) => city.name === "Omaha"));
  assert.notDeepEqual(getCities("US", "NE").map((city) => city.name), getCities("US", "CA").map((city) => city.name));
});

test("gathered location hydrates the real cascading country, state, and city options", () => {
  const draft = createEmptyProfileInput();
  const hydrated = withGatheredLocation(draft, { country: "United States", countryCode: "US", state: "NE", city: "Omaha" });
  assert.deepEqual({ country: hydrated.country, countryCode: hydrated.countryCode, state: hydrated.state, stateCode: hydrated.stateCode, city: hydrated.city }, {
    country: "United States", countryCode: "US", state: "Nebraska", stateCode: "NE", city: "Omaha",
  });
});

test("asset validation accepts the intended formats and rejects others", () => {
  assert.equal(validateLogoFile(new File(["image"], "logo.png", { type: "image/png" })), null);
  assert.match(validateLogoFile(new File(["pdf"], "logo.pdf", { type: "application/pdf" })), /image/);
  assert.equal(validateBrochureFile(new File(["pdf"], "brochure.pdf", { type: "application/pdf" })), null);
  assert.match(validateBrochureFile(new File(["image"], "brochure.png", { type: "image/png" })), /PDF/);
});

test("uploaded asset metadata is lightweight and serializable", () => {
  const ref = createAssetRef(new File(["pdf contents"], "brochure.pdf", { type: "application/pdf" }), "asset-1");
  assert.deepEqual(ref, { id: "asset-1", fileName: "brochure.pdf", mimeType: "application/pdf", size: 12 });
  assert.equal(JSON.stringify(ref).includes("pdf contents"), false);
});

test("GMB wins core conflicts while website supplies detail, and one source can be unavailable", () => {
  const result = composeGatherResult({
    gmb: { facts: { businessName: "GMB Name", phone: "402-1000", description: "", services: [] }, links: [], text: "" },
    website: { facts: { businessName: "Website Name", phone: "402-2000", description: "Source-supported detail", services: ["Boundary Survey"] }, links: [], text: "" },
  }, { gmbUrl: "https://google.com/maps/place/business", websiteUrl: "https://example.com" });
  assert.equal(result.profile.businessName, "GMB Name");
  assert.equal(result.profile.phone, "402-1000");
  assert.equal(result.profile.description, "Source-supported detail");
  assert.equal(result.warnings.length, 0);

  const partial = composeGatherResult({ gmb: null, website: { facts: { businessName: "Website Name", phone: "402-2000" }, links: [], text: "" } }, { gmbUrl: "https://google.com/maps/place/business", websiteUrl: "https://example.com" });
  assert.equal(partial.profile.phone, "402-2000");
  assert.equal(partial.statuses.find((item) => item.source === "gmb").status, "unavailable");
});

test("generic Google shell is unavailable and website data becomes the draft", () => {
  const google = extractSnapshot("<html><head><title>Google Maps</title></head><body>Google Maps Search Directions</body></html>", new URL("https://www.google.com/maps/place/example"), "gmb");
  const website = extractSnapshot(`<html><head><title>Acme HVAC | Home</title><meta name="description" content="Acme HVAC provides heating and cooling services for homes and businesses."></head><body><script type="application/ld+json">${JSON.stringify({ "@type": "HVACBusiness", name: "Acme HVAC", telephone: "402-555-0100", email: "hello@acme.example", url: "https://acme.example", category: "HVAC contractor", address: { streetAddress: "10 Main Street", addressLocality: "Omaha", addressRegion: "NE", postalCode: "68102", addressCountry: "US" }, openingHoursSpecification: [{ dayOfWeek: ["Monday", "Tuesday"], opens: "08:00", closes: "17:00" }] })}</script><h1>Acme HVAC</h1><p>Acme HVAC provides dependable heating and cooling services for residential and commercial customers.</p><a href="/services/repair">Repair</a><a href="/about">About</a></body></html>`, new URL("https://acme.example"));
  const result = composeGatherResult({ gmb: google, website }, { gmbUrl: "https://www.google.com/maps/place/example", websiteUrl: "https://acme.example" });
  assert.equal(result.statuses.find((item) => item.source === "gmb").status, "unavailable");
  assert.equal(result.profile.businessName, "Acme HVAC");
  assert.equal(result.profile.country, "United States");
  assert.equal(result.profile.state, "Nebraska");
  assert.equal(result.profile.stateCode, "NE");
  assert.equal(result.profile.city, "Omaha");
  assert.equal(result.profile.phone, "402-555-0100");
  assert.match(result.profile.description, /heating and cooling/);
  assert.ok(result.profile.businessHours.some((hour) => hour.includes("Monday")));
  assert.ok(result.profile.services.includes("Repair"));
  assert.ok(result.internalLinks.some((link) => link.url === "https://acme.example/services/repair"));
  assert.ok(result.profile.shortDescription.length <= 160);
  assert.doesNotMatch(result.profile.shortDescription, /Google Maps/i);
});

test("generic Google shell values cannot override a real website entity", () => {
  const result = composeGatherResult({
    gmb: { facts: { businessName: "Google Maps", description: "Google Maps provides local business." }, links: [], text: "" },
    website: { facts: { businessName: "Real Client", description: "Real client source content." }, links: [], text: "" },
  }, { gmbUrl: "https://www.google.com/maps/place/example", websiteUrl: "https://client.example" });
  assert.equal(result.profile.businessName, "Real Client");
  assert.equal(result.profile.description, "Real client source content.");
  assert.notEqual(result.statuses.find((item) => item.source === "gmb").status, "success");
});

test("Google source validation rejects lookalike domains", () => {
  assert.match(validateSourceUrl("https://notgoogle.com/maps", "gmb"), /Google Maps/);
  assert.equal(validateSourceUrl("https://maps.google.com/place/example", "gmb"), null);
});

test("GMB core facts override website while website fills missing values and hours", () => {
  const result = composeGatherResult({
    gmb: { facts: { businessName: "Trusted Business", phone: "402-1111", category: "Roofing contractor", country: "USA", state: "NE", city: "Omaha", businessHours: ["Monday: 8:00 AM - 5:00 PM"] }, links: [], text: "" },
    website: { facts: { businessName: "Website Business", phone: "402-2222", email: "hello@example.com", address: "10 Main Street", country: "US", state: "Nebraska", city: "Omaha", description: "Website-supported business description.", services: ["Roof Repair", "Roof Repair", "Installation"] }, links: [], text: "" },
  }, { gmbUrl: "https://google.com/maps/place/business", websiteUrl: "https://example.com" });
  assert.equal(result.profile.businessName, "Trusted Business");
  assert.equal(result.profile.phone, "402-1111");
  assert.equal(result.profile.category, "Roofing contractor");
  assert.equal(result.profile.email ?? "", "", "Website email must not populate Submission Email");
  assert.equal(result.profile.address, "10 Main Street");
  assert.deepEqual(result.profile.services, ["Roof Repair", "Installation"]);
  assert.deepEqual(result.profile.businessHours, ["Monday: 8:00 AM - 5:00 PM"]);
  assert.equal(result.profile.countryCode, "US");
  assert.equal(result.profile.stateCode, "NE");
});

test("website services are source-supported, deduplicated, and capped at ten", () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({ "@type": "Service", name: `Service ${index + 1}` }));
  entries.push({ "@type": "Service", name: "Service 1" });
  const snapshot = extractSnapshot(`<html><head><script type="application/ld+json">${JSON.stringify(entries)}</script></head><body><h1>Real Client</h1></body></html>`, new URL("https://client.example"));
  assert.equal(snapshot.facts.services.length, 10);
  assert.equal(new Set(snapshot.facts.services).size, 10);
  assert.deepEqual(snapshot.facts.services.slice(0, 3), ["Service 1", "Service 2", "Service 3"]);
});

test("visible HTML website fallback extracts contact, location, hours, services, and links without JSON-LD", () => {
  const html = `<html><head><title>Precision Surveying &amp; Consulting | Home</title></head><body>
    <nav><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/connect-vdc">Connect VDC</a><a href="/services/data-center-surveying">Data Center Surveying</a></nav>
    <main><h1>Precision Surveying &amp; Consulting</h1><h2>Services</h2><h3>Construction Staking</h3><h3>As-Builting</h3><h3>Private Site 811 Management</h3></main>
    <footer><p>Contact Us</p><p>info@precisionsurvey.tech</p><p>(402) 278-1666</p><p>3803 North 153rd Street Suite 100-101</p><p>Omaha, NE 68116</p><p>Monday-Friday: 7:00 AM-5:00 PM</p><p>Closed Saturday and Sunday</p><a href="/blog">Blog</a><a href="/careers">Careers</a><a href="/contact">Contact</a></footer>
  </body></html>`;
  const website = extractSnapshot(html, new URL("https://precisionsurveyingandconsulting.com/"));
  const result = composeGatherResult({ gmb: null, website }, { gmbUrl: "https://www.google.com/maps/place/example", websiteUrl: "https://precisionsurveyingandconsulting.com/" });
  assert.equal(result.profile.businessName, "Precision Surveying & Consulting");
  assert.equal(result.profile.email ?? "", "", "Website email must not populate Submission Email");
  assert.equal(result.profile.phone, "(402) 278-1666");
  assert.equal(result.profile.address, "3803 North 153rd Street Suite 100-101");
  assert.deepEqual({ city: result.profile.city, state: result.profile.state, stateCode: result.profile.stateCode, postalCode: result.profile.postalCode }, { city: "Omaha", state: "Nebraska", stateCode: "NE", postalCode: "68116" });
  assert.ok(result.profile.services.includes("Construction Staking"));
  assert.ok(result.profile.services.includes("As-Builting"));
  assert.ok(result.profile.services.includes("Private Site 811 Management"));
  assert.equal(result.profile.businessHours.length, 7);
  assert.ok(result.internalLinks.length > 0 && result.internalLinks.length <= 12);
  assert.equal(result.statuses.find((item) => item.source === "website").status, "success");
});

test("source status is partial when a source has data but not a reliable business entity", () => {
  const result = composeGatherResult({
    gmb: { facts: { phone: "402-1111" }, links: [], text: "" },
    website: null,
  }, { gmbUrl: "https://google.com/maps/place/business", websiteUrl: "https://example.com" });
  assert.equal(result.statuses.find((item) => item.source === "gmb").status, "partial");
});

test("internal links prioritize commercial pages, dedupe, filter external links, and cap at 12", () => {
  const links = rankInternalLinks([
    { label: "Privacy", url: "https://example.com/privacy", score: -8, commercial: false },
    { label: "Boundary Survey", url: "https://example.com/boundary", score: 7, commercial: true },
    { label: "Boundary Survey duplicate", url: "https://example.com/boundary#top", score: 6, commercial: true },
    { label: "External Service", url: "https://other.example/service", score: 9, commercial: true },
    ...Array.from({ length: 14 }, (_, index) => ({ label: `Useful page ${index}`, url: `https://example.com/page-${index}`, score: 1, commercial: false })),
  ], "https://example.com");
  assert.equal(links.length, 12);
  assert.equal(links[0].label, "Boundary Survey");
  assert.ok(links.every((link) => link.url.startsWith("https://example.com/")));
  assert.equal(new Set(links.map((link) => link.url)).size, links.length);
  assert.equal(links.filter((link) => link.type === "fallback").length, 11);
});

test("generated short description counts spaces and stays complete under 160 characters", () => {
  const description = generateShortDescription({ businessName: "A Very Long Business Name That Still Needs To Read Naturally", category: "A category with many words that could overflow the maximum" }, []);
  assert.ok(description.length <= 160);
  assert.ok(description.endsWith("."));
  assert.equal(description.includes("undefined"), false);
});

test("social links accept supported domains and prevent duplicate platforms in the model", () => {
  assert.equal(isSupportedSocialUrl("instagram", "https://www.instagram.com/example"), true);
  assert.equal(isSupportedSocialUrl("twitter", "https://x.com/example"), true);
  assert.equal(isSupportedSocialUrl("facebook", "https://not-facebook.example"), false);
  const profile = normalizeBusinessProfile({ id: "old", businessName: "Old", services: [], businessHours: [], internalLinks: [], facebook: "https://facebook.com/example" });
  assert.equal(profile.facebook, "https://facebook.com/example");
  assert.deepEqual(profile.internalLinks, []);
});

test("social URLs detect every supported platform and preserve unknown URLs", () => {
  assert.equal(detectSocialPlatform("https://facebook.com/example"), "facebook");
  assert.equal(detectSocialPlatform("https://instagram.com/example"), "instagram");
  assert.equal(detectSocialPlatform("https://linkedin.com/in/example"), "linkedin");
  assert.equal(detectSocialPlatform("https://x.com/example"), "twitter");
  assert.equal(detectSocialPlatform("https://twitter.com/example"), "twitter");
  assert.equal(detectSocialPlatform("https://youtube.com/@example"), "youtube");
  assert.equal(detectSocialPlatform("https://youtu.be/example"), "youtube");
  assert.equal(detectSocialPlatform("https://tiktok.com/@example"), "tiktok");
  assert.equal(detectSocialPlatform("https://pinterest.com/example"), "pinterest");
  assert.equal(detectSocialPlatform("https://example.com/social"), "other");
});

test("adding a social URL appends a row and prevents duplicate URLs", () => {
  const first = addSocialLink([], { url: "https://facebook.com/example", platform: "facebook" });
  const second = addSocialLink(first, { url: "https://instagram.com/example", platform: "instagram" });
  const duplicate = addSocialLink(second, { url: " https://facebook.com/example ", platform: "facebook" });
  assert.equal(second.length, 2);
  assert.equal(duplicate.length, 2);
});

test("existing platform social fields migrate into URL/platform records without duplicates", () => {
  const profile = normalizeBusinessProfile({ id: "social-migration", businessName: "Business", facebook: "https://facebook.com/example", twitter: "https://x.com/example", socialLinks: [{ url: "https://facebook.com/example", platform: "facebook" }], services: [], businessHours: [], internalLinks: [] });
  assert.deepEqual(profile.socialLinks, [
    { url: "https://facebook.com/example", platform: "facebook" },
    { url: "https://x.com/example", platform: "twitter" },
  ]);
});

test("first and last names derive for legacy profiles and preserve manual values", () => {
  const legacy = normalizeBusinessProfile({ id: "legacy-name", businessName: "Charming Skin Vein Clinics", services: [], businessHours: [], internalLinks: [] });
  assert.deepEqual({ firstName: legacy.firstName, lastName: legacy.lastName }, { firstName: "Charming", lastName: "Clinics" });
  const manual = normalizeBusinessProfile({ id: "manual-name", businessName: "Charming Skin Vein Clinics", firstName: "Dr. Charming", lastName: "Vein", services: [], businessHours: [], internalLinks: [] });
  assert.deepEqual({ firstName: manual.firstName, lastName: manual.lastName }, { firstName: "Dr. Charming", lastName: "Vein" });
  const savedPassword = normalizeBusinessProfile({ id: "password-profile", businessName: "Business", password: "Saved-Password", services: [], businessHours: [], internalLinks: [] });
  assert.equal(savedPassword.password, "Saved-Password");
  const imageProfile = normalizeBusinessProfile({ id: "image-profile", businessName: "Business", imageUrl: "https://example.com/image.jpg", services: [], businessHours: [], internalLinks: [] });
  assert.equal(imageProfile.imageUrl, "https://example.com/image.jpg");
  const migrated = normalizeBusinessProfile({ id: "structured-address", businessName: "Business", address: "5907 W 63rd St", city: "Chicago", state: "Illinois", stateCode: "IL", postalCode: "60638", country: "United States", services: [], businessHours: [], internalLinks: [] });
  assert.equal(migrated.address, "5907 W 63rd St", "structured street address should remain available after migration");
  assert.equal(migrated.completeAddress, "5907 W 63rd St, Chicago, IL 60638, United States", "structured location should migrate to one complete address");
  assert.equal(formatBusinessAddress("5907 W 63rd St", "Chicago", "Illinois", "IL", "60638", "United States"), migrated.completeAddress);
  const empty = createEmptyProfileInput();
  assert.equal(empty.firstName, "");
  assert.equal(empty.lastName, "");
  assert.equal(empty.password, "");
  assert.equal(empty.completeAddress, "");
});

test("manual Username persists after save and reopen", async () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } };
  try {
    const repository = createLocalStorageProfileRepository();
    const input = { ...createEmptyProfileInput(), businessName: "Username Business", username: "manual-user", imageUrl: "https://example.com/profile-image.jpg" };
    const saved = await repository.create(input);
    const reopened = await repository.get(saved.id);
    assert.equal(reopened?.username, "manual-user");
    assert.equal(reopened?.imageUrl, "https://example.com/profile-image.jpg");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
