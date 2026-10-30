import { createSiteAdapter } from "./site-adapter";
import type { ListingField } from "../messages";

// Names/types and native Continue control observed by GET on 2026-10-17.
export const NATIVE_DIRECTORY_FIELDS = [
  { name: "TITLE", tag: "INPUT", field: "businessName" },
  { name: "URL", tag: "INPUT", field: "website" },
  { name: "DESCRIPTION", tag: "TEXTAREA", field: "description" },
  { name: "OWNER_NAME", tag: "INPUT", field: "contactName" },
  { name: "OWNER_EMAIL", tag: "INPUT", field: "email" },
  { name: "CATEGORY_ID", tag: "SELECT", field: "category" },
] as const satisfies ReadonlyArray<{ name: string; tag: string; field: ListingField }>;

export function isNativeDirectoryHost(value: string, domain: string): boolean {
  try { return [domain, `www.${domain}`].includes(new URL(value).hostname); } catch { return false; }
}

export function isNativeDirectoryHumanControl(element: Element): boolean {
  const selector = '[data-sitekey], [id*="captcha" i], [class*="captcha" i], [name*="captcha" i], [aria-label*="captcha" i], [id*="turnstile" i], [class*="turnstile" i], iframe[src*="recaptcha" i]';
  return Boolean(element.closest(selector) || element.querySelector(selector));
}

export function nativeDirectoryEntryLinks(doc: ParentNode) {
  // Expansion's recorded image link is named by title, not textContent.
  // Exact configured labels and safe same-site form targets remain mandatory.
  return [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => !isNativeDirectoryHumanControl(a)).map(a => ({
    text: a.textContent?.trim() || (a.querySelector("img") ? a.getAttribute("title") || "" : ""), href: a.href,
  }));
}

function safeUrl(value: string, site: NativeDirectorySite): URL | null {
  try {
    const url = new URL(value);
    return isNativeDirectoryHost(value, site.domain) && site.protocols.includes(url.protocol) && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

export type NativeDirectorySite = { id: string; domain: string; name: string; startingUrl: string; protocols: readonly string[]; entryLabels?: readonly string[]; submitValue?: "Submit"; manualRadio?: { name: string; value: string }; manualTerms?: { name: string; value: string; label: string; rulesPath: string; exitValue: string } };
function isSubmitPage(url: URL): boolean {
  return url.pathname === "/submit.php" && [...url.searchParams].every(([key, value]) => key === "c" && /^\d+$/.test(value));
}

export function createNativeDirectoryAdapter(site: NativeDirectorySite) {
  const adapter = createSiteAdapter({
    id: site.id, domains: [site.domain], startingUrl: site.startingUrl,
    entryLabels: [...(site.entryLabels || ["Submit Links"])],
    fieldHints: { businessName: ["TITLE"], website: ["URL"], description: ["DESCRIPTION"], contactName: ["OWNER_NAME"], email: ["OWNER_EMAIL"], category: ["CATEGORY_ID"] },
    manualGates: ["Reciprocal Link URL", "CAPTCHA", "Terms/Agreement", "Final Continue / Submit"],
    // Neither a filled form nor a Continue click proves publication.
  });
  adapter.matches = value => safeUrl(value, site) !== null;
  adapter.discoverEntry = (_text, links) => {
    const urls = [...new Set(links.filter(link => adapter.config.entryLabels.some(label => label.toLowerCase() === link.text.trim().toLowerCase())).map(link => safeUrl(link.href, site)).filter((url): url is URL => !!url && isSubmitPage(url)).map(url => url.href))];
    return urls.length === 1 ? { action: "CLICK", target: urls[0], confidence: 0.9, reason: `Observed ${site.name} ${adapter.config.entryLabels.join("/")} navigation` } : null;
  };
  return adapter;
}
type Inspection = { state: "entry" } | { state: "unsupported"; reason: string } | { state: "form"; form: HTMLFormElement; submit: HTMLInputElement; manual?: string[] };

export function inspectNativeDirectory(doc: Document, value: string, site: NativeDirectorySite): Inspection {
  const url = safeUrl(value, site);
  const unsupported = (reason: string): Inspection => ({ state: "unsupported", reason });
  if (!url) return unsupported(`${site.name} requires its verified exact origin/protocol`);
  if (!isSubmitPage(url)) return ["/", "/index.php"].includes(url.pathname) && !url.search ? { state: "entry" } : unsupported(`Unverified ${site.name} page`);
  const forms = [...doc.querySelectorAll("form")].filter(form => form.querySelector('[name="TITLE"]'));
  if (forms.length !== 1) return unsupported("Missing or ambiguous native listing form");
  const form = forms[0];
  let action: URL;
  try { action = new URL(form.getAttribute("action") || value, doc.baseURI || value); }
  catch { return unsupported("Invalid native listing form action"); }
  if (form.method.toLowerCase() !== "post" || action.origin !== url.origin || !isSubmitPage(action) || form.target && form.target !== "_self") return unsupported("Unverified native listing form action");
  for (const spec of NATIVE_DIRECTORY_FIELDS) {
    const controls = [...form.elements].filter(el => el.getAttribute("name") === spec.name);
    const element = controls[0] as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (controls.length !== 1 || element.tagName !== spec.tag || element.disabled || (element as HTMLInputElement).readOnly || element.closest("form") !== form
      || element.hasAttribute("hidden") || element.closest('[hidden], [inert], [aria-hidden="true"]') || spec.tag === "INPUT" && (element as HTMLInputElement).type !== "text") return unsupported(`Unverified or unavailable control: ${spec.name}`);
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = doc.defaultView?.getComputedStyle(node);
      if (style?.display === "none" || style?.visibility === "hidden") return unsupported(`Hidden native control: ${spec.name}`);
    }
  }
  const allowed = new Set<string>([...NATIVE_DIRECTORY_FIELDS.map(spec => spec.name), "RECPR_URL", "RECPR_TEXT", "g-recaptcha-response"]);
  const manual: string[] = [];
  const manualControls = new Set<Element>();
  if (site.manualRadio) {
    const controls = [...form.querySelectorAll<HTMLInputElement>("input")].filter(el => el.name === site.manualRadio!.name);
    if (controls.length !== 1 || controls[0].type !== "radio" || controls[0].value !== site.manualRadio.value || controls[0].disabled) return unsupported("Missing or changed manual listing-type radio");
    manual.push(`${site.manualRadio.name} listing type requires human selection; left unchanged`);
  }
  if (site.manualTerms) {
    const spec = site.manualTerms;
    const controls = [...form.querySelectorAll<HTMLInputElement>("input")].filter(el => el.name === spec.name);
    const checkbox = controls[0];
    if (controls.length !== 1 || checkbox.type !== "checkbox" || checkbox.value !== spec.value || checkbox.disabled || checkbox.hasAttribute("hidden")
      || checkbox.closest('[hidden], [inert], [aria-hidden="true"]') || form.querySelectorAll('input[type="checkbox"]').length !== 1) return unsupported("Missing or changed manual Terms checkbox");
    const rules = [...(checkbox.parentElement?.querySelectorAll<HTMLAnchorElement>('a[href]') || [])].filter(link => {
      try {
        const rule = new URL(link.getAttribute("href")!, doc.baseURI || value);
        return link.textContent?.replace(/\s+/g, " ").trim() === spec.label && rule.origin === url.origin && rule.pathname === spec.rulesPath && !rule.search && !rule.hash && !rule.username && !rule.password;
      } catch { return false; }
    });
    if (rules.length !== 1) return unsupported("Missing or changed manual Terms label/rules link");
    const exits = [...form.querySelectorAll<HTMLInputElement>('input[type="button"]')];
    const exit = exits[0];
    if (exits.length !== 1 || exit.value !== spec.exitValue || exit.name || exit.id || exit.disabled || form.querySelectorAll('input[type="button"],button[type="button"]').length !== 1) return unsupported("Missing or changed manual Exit control");
    manualControls.add(checkbox); manualControls.add(exit);
    manual.push(`${spec.label} checkbox requires human acceptance; left unchanged`, `${spec.exitValue} control is manual; never clicked`);
  }
  const unknown = [...form.querySelectorAll("input,textarea,select")].some(el => {
    if (manualControls.has(el)) return false;
    const type = el.getAttribute("type")?.toLowerCase();
    if (site.manualRadio && type === "radio" && el.getAttribute("name") === site.manualRadio.name && (el as HTMLInputElement).value === site.manualRadio.value) return false;
    return !["hidden", "submit", "checkbox"].includes(type || "") && !allowed.has(el.getAttribute("name") || "");
  });
  if (unknown) return unsupported("Unverified additional listing controls (including uploads)");
  const submits = [...form.querySelectorAll<HTMLInputElement>('input[type="submit"][name="submit"]')];
  const submit = submits[0];
  const expectedSubmit = site.submitValue || "Continue";
  if (submits.length !== 1 || submit.value !== expectedSubmit || submit.disabled || submit.hasAttribute("formaction") || submit.hasAttribute("formmethod")
    || submit.hasAttribute("formtarget") || form.querySelectorAll('button:not([type="button"]),input[type="submit"],input[type="image"]').length !== 1) return unsupported(`Missing or changed native ${expectedSubmit} control`);
  return { state: "form", form, submit, ...(manual.length ? { manual } : {}) };
}

