import { inspectJetLinks } from "../automation/jet-links";

// Consent lives only in this document. Never stored, inferred from autofill, or reused.
export function createJetTermsConsent(doc: Document, fetcher: typeof fetch = fetch, now = Date.now) {
  let pending: { id: number; text: string; url: string; page: string; form: HTMLFormElement; checkbox: HTMLInputElement; expires: number } | undefined;
  let sequence = 0;
  function context() {
    const result = inspectJetLinks(doc, doc.location.href);
    if (result.state !== "form") throw Error("Jet submission form is unavailable or has changed.");
    return { form: result.form, checkbox: result.form.querySelector<HTMLInputElement>('input[name="agree"]')!, page: doc.location.href, url: new URL("/rules.php", doc.location.href).href };
  }
  async function terms(url: string) {
    const response = await fetcher(url, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok || response.redirected || response.url && response.url !== url || !/text\/html/i.test(response.headers.get("content-type") || "")) throw Error("Jet Terms could not be retrieved safely.");
    const html = await response.text();
    if (html.length > 200000) throw Error("Jet Terms response is too large to review safely.");
    const template = doc.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("script,style,noscript,iframe,object,embed,head").forEach(node => node.remove());
    template.content.querySelectorAll("a[href]").forEach(link => { link.textContent += ` (${new URL(link.getAttribute("href")!, url).href})`; });
    const text = (template.content.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || /captcha|access denied|forbidden|verify you are human|just a moment|checking your browser/i.test(text)) throw Error("Jet Terms are empty or blocked. Do not accept; ask the site to restore its Terms.");
    return text;
  }
  return {
    async review() {
      pending = undefined;
      const id = ++sequence;
      const current = context();
      const text = await terms(current.url);
      const latest = context();
      if (sequence !== id || current.form !== latest.form || current.checkbox !== latest.checkbox || current.page !== latest.page) throw Error("Jet form changed during Terms review.");
      pending = { ...current, id, text, expires: now() + 5 * 60 * 1000 };
      return { id, text, url: current.url };
    },
    async approve(id: number, explicitlyApproved: boolean) {
      const approval = pending;
      pending = undefined; // Single use, including failures and lost acknowledgements.
      if (explicitlyApproved !== true || !approval || approval.id !== id || now() >= approval.expires) throw Error("Fresh explicit approval of the displayed Jet Terms is required.");
      const current = context();
      if (current.form !== approval.form || current.checkbox !== approval.checkbox || current.page !== approval.page) throw Error("Jet form changed; review Terms again.");
      if (await terms(current.url) !== approval.text) throw Error("Jet Terms changed; review and approve the new Terms.");
      const latest = context();
      if (now() >= approval.expires || sequence !== id || latest.form !== approval.form || latest.checkbox !== approval.checkbox || latest.page !== approval.page) throw Error("Jet approval expired or form changed.");
      // No click or change events: they could invoke unrelated page actions.
      latest.checkbox.checked = true;
    },
  };
}

/** Separate optional human checkpoint; ordinary native autofill still never checks Terms. */
export function installJetTermsReview(doc: Document = document) {
  if (inspectJetLinks(doc, doc.location.href).state !== "form" || doc.getElementById("mahid-jet-terms")) return;
  const host = doc.createElement("div");
  host.id = "mahid-jet-terms";
  // Outside the form, with controls isolated from the site's form detector/scripts.
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>:host{display:block;margin:16px;padding:16px;border:2px solid #375b86;background:white;color:#172333;font:14px system-ui}pre{white-space:pre-wrap;max-height:240px;overflow:auto}button{padding:8px;margin-right:8px}</style><strong>MAHID · Jet Links Terms</strong><p>Optional: review the applicable Terms before approving checkbox selection. CAPTCHA and Continue remain manual.</p><button type="button" id="review">Review Jet Terms</button><p id="source"></p><pre id="text"></pre><button type="button" id="approve" disabled>I approve these Terms — select the Jet checkbox</button><p id="status" role="status"></p>`;
  const review = root.querySelector<HTMLButtonElement>("#review")!;
  const approve = root.querySelector<HTMLButtonElement>("#approve")!;
  const status = root.querySelector<HTMLElement>("#status")!;
  const consent = createJetTermsConsent(doc);
  let reviewId: number | undefined;
  review.addEventListener("click", async event => {
    if (!event.isTrusted) return;
    reviewId = undefined; approve.disabled = true; review.disabled = true;
    root.querySelector("#text")!.textContent = "";
    status.textContent = "Loading Jet Terms…";
    try {
      const result = await consent.review(); reviewId = result.id;
      root.querySelector("#source")!.textContent = result.url;
      root.querySelector("#text")!.textContent = result.text;
      approve.disabled = false; status.textContent = "Read the Terms. Approve only if you agree.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Terms review failed."; }
    finally { review.disabled = false; }
  });
  approve.addEventListener("click", async event => {
    if (!event.isTrusted || reviewId === undefined) return;
    const id = reviewId; reviewId = undefined; approve.disabled = true; review.disabled = true;
    try { await consent.approve(id, true); status.textContent = "Terms checkbox selected after your approval. Nothing submitted. CAPTCHA and Continue remain manual."; }
    catch (error) { status.textContent = error instanceof Error ? error.message : "Terms approval failed."; }
    finally { review.disabled = false; }
  });
  doc.body.append(host);
}
