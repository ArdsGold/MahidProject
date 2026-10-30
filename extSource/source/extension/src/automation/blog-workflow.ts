import { publicArticleUrl } from "./verification";
import { DEFAULT_PUBLICATION_ADAPTER, getSiteAdapter, isGroup1Url } from "./adapters";
import type { BusinessProfile } from "@backlink-autofill/shared";
import { findAmpBlogsLoginSubmit } from "../ampblogs";

export interface LoginCheck { ok: boolean; captcha: "pending" | "verified" | "absent" | "ambiguous"; reason: string }
// Includes the selector actually recorded in TheZENweb, not an assumed class.
export const CKEDITOR_FRAME_SELECTOR = 'iframe.cke_wysiwyg_frame, iframe[title*="Rich Text Editor" i], iframe[class*="cke_wysiwyg"]';
export type RegistrationCheck = Omit<LoginCheck, 'captcha'> & { captcha: LoginCheck['captcha'] | 'answer-entered' };

// Shared native-form detection already used by AmpBlogs; no host-specific auth adapter.
export function loginFields(documentRef: Document, url: string) {
  if (observeBlogWorkflow(documentRef, url).stage !== "LOGIN") return null;
  const submit = findAmpBlogsLoginSubmit(documentRef);
  const form = submit?.form;
  if (!submit || !form || !visible(submit) || submit.getAttribute("aria-disabled") === "true" || submit.getAttribute("aria-busy") === "true") return null;
  if (Array.from(form.querySelectorAll('button, input[type=submit]')).some(control => /register|sign\s*up|create\s+account/i.test(controlLabel(control)))) return null;
  const passwords = Array.from(form.querySelectorAll<HTMLInputElement>('input[type=password]')).filter(visible);
  const identifiers = Array.from(form.querySelectorAll<HTMLInputElement>('input:not([type]), input[type=text], input[type=email]')).filter(visible)
    .filter((field) => /user.?name|email|login/i.test(`${field.name} ${field.id} ${field.placeholder} ${field.autocomplete} ${Array.from(field.labels || []).map(l => l.textContent).join(" ")}`));
  if (passwords.length !== 1 || identifiers.length !== 1 || [passwords[0], identifiers[0]].some(f => f.disabled || f.readOnly)) return null;
  if ((submit.formMethod || form.method).toLowerCase() !== "post" || new URL(submit.getAttribute("formaction") || form.getAttribute("action") || url, url).origin !== new URL(url).origin
    || !["", "_self"].includes(submit.formTarget || form.target) || documentRef.querySelector("base[target]:not([target='_self'])")) return null;
  return { submit, form, password: passwords[0], identifier: identifiers[0] };
}

export function loginCaptcha(documentRef: Document, form: HTMLFormElement): LoginCheck["captcha"] {
  const widgets = Array.from(documentRef.querySelectorAll('[id="KEY-Captcha"], .g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="captcha"], iframe[src*="turnstile"]'));
  const key = form.querySelector('#KEY-Captcha');
  if (key) {
    // Observed KEY-Captcha script reveals this marker and disables both cursors only
    // in its server JSON valid:true callback. Never invoke the callback or endpoint.
    const knownScript = Array.from(documentRef.scripts).some(s => {
      try { const source = new URL(s.src, documentRef.location.href); const host = new URL(documentRef.location.href).hostname;
        return source.protocol === "https:" && [host, `cdn.${host}`].includes(source.hostname) && source.pathname === "/plugins/KEY-Captcha/captcha.js";
      } catch { return false; }
    });
    const container = key.querySelector<HTMLElement>('#puzzleContainer');
    const puzzle = container?.querySelector<HTMLElement>('#puzzle');
    const success = container?.querySelector<HTMLElement>('#validPuzzle');
    const unboundChallenge = Array.from(documentRef.querySelectorAll('[id*="captcha" i], [class*="captcha" i], [id*="puzzle" i], [class*="puzzle" i], [data-sitekey], [name*="captcha" i]'))
      .some(element => visible(element) && !key.contains(element) && element !== key);
    if (widgets.length !== 1 || unboundChallenge || !knownScript || !container || !puzzle || !success
      || key.querySelectorAll('#validPuzzle').length !== 1) return "ambiguous";
    return visible(success) && visible(container) && documentRef.defaultView?.getComputedStyle(puzzle).cursor === "default"
      && documentRef.defaultView?.getComputedStyle(container).cursor === "default" ? "verified" : "pending";
  }
  // Unknown puzzle/success classes and prose are never proof. Provider response
  // fields are accepted only with one corresponding widget in this login form.
  const providers = [[".g-recaptcha", "g-recaptcha-response"], [".h-captcha", "h-captcha-response"], [".cf-turnstile", "cf-turnstile-response"]] as const;
  const present = providers.filter(([selector]) => form.querySelector(selector));
  if (present.length === 1 && widgets.every(widget => form.contains(widget))) {
    const [selector, name] = present[0];
    const tokens = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`input[name="${name}"], textarea[name="${name}"]`);
    if (form.querySelectorAll(selector).length !== 1 || tokens.length !== 1) return "ambiguous";
    return tokens[0].value.trim() ? "verified" : "pending";
  }
  return widgets.length || documentRef.querySelector('[id*="captcha" i], [class*="captcha" i], [id*="puzzle" i], [class*="puzzle" i], [name*="captcha" i]') ? "ambiguous" : "absent";
}

export function validateLogin(documentRef: Document, url: string, profile: BusinessProfile): LoginCheck {
  const fields = loginFields(documentRef, url);
  if (!fields) return { ok: false, captcha: "ambiguous", reason: "Login form or Sign In control is missing, unsafe, or ambiguous. Sign In remains manual." };
  const { identifier, password, form } = fields;
  const email = identifier.type === "email" || /email/i.test(`${identifier.name} ${identifier.id} ${identifier.placeholder}`);
  const expected = email ? profile.email : profile.username;
  if (!expected || !profile.password || identifier.value !== expected || password.value !== profile.password)
    return { ok: false, captcha: "ambiguous", reason: "Login fields do not match the authorized account. Review the selected profile and fields manually." };
  const captcha = loginCaptcha(documentRef, form);
  const required = Array.from(form.elements).filter((field): field is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => "required" in field);
  const agreements = Array.from(form.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).filter(visible)
    .filter(field => /terms|agree|conditions|privacy/i.test(`${field.name} ${field.id} ${Array.from(field.labels || []).map(l => l.textContent).join(" ")}`));
  if (agreements.some(field => !field.checked) || required.some(field => !field.disabled && field.required && !field.checkValidity())) return { ok: false, captcha, reason: "Required login fields or human agreements need attention. MAHID never checks Terms." };
  if (captcha === "pending") return { ok: false, captcha, reason: "Complete CAPTCHA on the website. Authorized Sign In will continue automatically." };
  if (captcha === "ambiguous") return { ok: false, captcha, reason: "CAPTCHA completion cannot be reliably established. Sign In remains manual." };
  return { ok: true, captcha, reason: "Authorized account, required fields, CAPTCHA, and unique Sign In control validated." };
}

// Evidence-only registration adapter: a unique native same-origin POST form,
// explicit Register control and labelled account fields. Unknown layouts stop.
export function registrationFields(documentRef: Document, url: string) {
  if (new URL(url).protocol !== 'https:' || observeBlogWorkflow(documentRef, url).stage !== 'SIGNUP') return null;
  const controls = Array.from(documentRef.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input[type=submit]'))
    .filter(visible).filter(e => /^(?:register|sign\s*up|create\s+(?:an?\s+)?account)$/i.test(controlLabel(e)));
  if (controls.length !== 1) return null;
  const submit = controls[0], form = submit.form;
  if (!form || submit.disabled || submit.getAttribute('aria-disabled') === 'true' || submit.getAttribute('aria-busy') === 'true'
    || !['submit', 'button'].includes(submit.type) || (submit.formMethod || form.method).toLowerCase() !== 'post'
    || new URL(submit.getAttribute('formaction') || form.getAttribute('action') || url, url).origin !== new URL(url).origin
    || !['', '_self'].includes(submit.formTarget || form.target) || documentRef.querySelector("base[target]:not([target='_self'])")) return null;
  const fields = Array.from(form.querySelectorAll<HTMLInputElement>('input')).filter(visible);
  const label = (f: HTMLInputElement) => `${f.name} ${f.id} ${f.placeholder} ${f.autocomplete} ${Array.from(f.labels || []).map(l => l.textContent).join(' ')}`;
  const passwords = fields.filter(f => f.type === 'password');
  const emails = fields.filter(f => f.type === 'email' || /email/i.test(label(f)) && ['text', ''].includes(f.type));
  const usernames = fields.filter(f => !emails.includes(f) && ['text', ''].includes(f.type) && /user.?name|login.?name|blog.?name/i.test(label(f)));
  if (emails.length !== 1 || usernames.length > 1 || passwords.length < 1 || passwords.length > 2
    || passwords.length === 2 && passwords.filter(f => /confirm|repeat|re.?enter/i.test(label(f))).length !== 1
    || [...passwords, ...emails, ...usernames].some(f => f.disabled || f.readOnly)
    || Array.from(documentRef.querySelectorAll('input[type=password]')).filter(visible).some(f => !form.contains(f))) return null;
  return { form, submit, passwords, email: emails[0], username: usernames[0] };
}

function registrationCaptcha(documentRef: Document, url: string, form: HTMLFormElement): RegistrationCheck['captcha'] {
  // Individually audited Group 1 native image CAPTCHA. An entered answer is readiness for
  // ONE server evaluation, never evidence of correctness or verification.
  const page = new URL(url);
  if (page.protocol !== 'https:' || !isGroup1Url(url)) return loginCaptcha(documentRef, form);
  const images = documentRef.querySelectorAll<HTMLImageElement>('img#captcha');
  const answers = documentRef.querySelectorAll<HTMLInputElement>('input[name="captcha"]');
  if (images.length !== 1 || answers.length !== 1) return loginCaptcha(documentRef, form);
  const image = images[0], answer = answers[0];
  const source = new URL(image.getAttribute('src') || '', url);
  // Actual Pointblog markup groups both controls in this layout wrapper.
  // It is not a second challenge; unrelated/nested challenge nodes still fail.
  const container = form.querySelector('div.captcha-register');
  const challenges = Array.from(documentRef.querySelectorAll('[id*="captcha" i], [class*="captcha" i], [id*="puzzle" i], [class*="puzzle" i], [name*="captcha" i], [data-sitekey], iframe[src*="captcha"], iframe[src*="turnstile"]'));
  if (!form.contains(image) || answer.form !== form || !visible(image) || !visible(answer)
    || answer.type !== 'text' || answer.disabled || answer.readOnly
    || source.origin !== page.origin || source.pathname !== '/plugins/cool-php-captcha-0.3.1/captcha.php'
    || challenges.some(element => element !== image && element !== answer
      && !(element === container && container.contains(image) && container.contains(answer)))) return 'ambiguous';
  return answer.value.trim() && answer.checkValidity() ? 'answer-entered' : 'pending';
}

export function validateRegistration(documentRef: Document, url: string, profile: BusinessProfile): RegistrationCheck {
  const fields = registrationFields(documentRef, url);
  if (!fields) return { ok: false, captcha: 'ambiguous', reason: 'Registration form/action/account fields are unsupported or ambiguous. Inspect the real website structure.' };
  const captcha = registrationCaptcha(documentRef, url, fields.form);
  if (!profile.email || !profile.password || fields.email.value !== profile.email || fields.passwords.some(f => f.value !== profile.password)
    || fields.username && (!profile.username || fields.username.value !== profile.username))
    return { ok: false, captcha, reason: 'Registration fields do not match the approved account details; missing values are never invented.' };
  if (Array.from(fields.form.querySelectorAll<HTMLInputElement>('input[type=checkbox]')).filter(visible)
    .some(f => !f.checked && /terms|agree|conditions|privacy/i.test(`${f.name} ${f.id} ${Array.from(f.labels || []).map(l => l.textContent).join(' ')}`)))
    return { ok: false, captcha, reason: 'Review and accept the website Terms manually. Registration will recheck automatically.' };
  if (Array.from(fields.form.elements).some(e => 'checkValidity' in e && !(e as HTMLInputElement).disabled && !(e as HTMLInputElement).checkValidity())
    || fields.form.querySelector('[autocomplete^="cc-"], [data-payment-required="true"]'))
    return { ok: false, captcha, reason: 'Required registration fields or payment need human attention.' };
  if (captcha !== 'absent' && captcha !== 'verified' && captcha !== 'answer-entered') return { ok: false, captcha, reason: 'Complete CAPTCHA on the website; unsupported challenge evidence remains manual.' };
  return { ok: true, captcha, reason: captcha === 'answer-entered'
    ? 'Manual CAPTCHA answer entered; correctness is unverified. Approved fields are ready for one authorized server evaluation.'
    : 'Approved account values, native registration action, required fields and human gates validated.' };
}

export type BlogWorkflowStage = "HOMEPAGE" | "LOGIN" | "SIGNUP" | "ACCOUNT_VERIFICATION" | "ACCOUNT_CREATED" | "AUTHENTICATED_DASHBOARD" | "EDITOR" | "CONFIRMATION" | "UNSUPPORTED";

export interface BlogWorkflowAction {
  kind: "login" | "signup" | "new-post";
  label: string;
  href: string;
}

export interface BlogWorkflowObservation {
  loginError?: boolean;
  authenticationEvidence?: boolean;
  registrationEvidence?: boolean;
  registrationError?: boolean;
  stage: BlogWorkflowStage;
  confidence: number;
  action?: BlogWorkflowAction;
  loginAction?: BlogWorkflowAction;
  signupAction?: BlogWorkflowAction;
  publicUrl?: string;
  publicationEvidence?: boolean;
  titleFieldPresent?: boolean;
  editorPresent?: boolean;
  publishControl?: { count: number; label?: string; enabled?: boolean };
  reason: string;
}

function normalized(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function lower(value: string): string { return normalized(value).toLowerCase(); }

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return false;
    const style = node.ownerDocument?.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

function sameOriginHref(value: string, url: string): string | undefined {
  if (!value || /^\s*(?:#|javascript:)/i.test(value)) return undefined;
  try {
    const base = new URL(url);
    const target = new URL(value, base);
    if (!/^https?:$/i.test(target.protocol) || target.origin !== base.origin) return undefined;
    target.hash = "";
    return target.href;
  } catch {
    return undefined;
  }
}

function controlLabel(element: Element): string {
  return normalized(element.getAttribute("aria-label") || element.textContent || element.getAttribute("value") || element.getAttribute("title") || "");
}

function actionFor(documentRef: Document, url: string, pattern: RegExp, kind: BlogWorkflowAction["kind"]): BlogWorkflowAction | undefined {
  const actions: BlogWorkflowAction[] = [];
  for (const element of Array.from(documentRef.querySelectorAll("a[href], [role=link][href], [data-href]"))) {
    if (!visible(element)) continue;
    const href = sameOriginHref(element.getAttribute("href") || element.getAttribute("data-href") || "", url);
    const label = controlLabel(element);
    if (href && pattern.test(label)) actions.push({ kind, label, href });
  }
  return actions.length === 1 ? actions[0] : undefined;
}

function hasPassword(documentRef: Document): boolean {
  return Array.from(documentRef.querySelectorAll<HTMLInputElement>('input[type="password"]')).some(visible);
}

function hasEditor(documentRef: Document): boolean {
  return documentRef.querySelector(`${CKEDITOR_FRAME_SELECTOR}, textarea#content, textarea[name="content"], textarea[name="post_content"], iframe#content_ifr, [contenteditable="true"]`) !== null;
}

function hasTitleField(documentRef: Document): boolean {
  return documentRef.querySelector('input#title, input[name="title"], input[placeholder*="title" i], [aria-label*="title" i]') !== null;
}

function publishControls(documentRef: Document): Array<{ label: string; enabled: boolean }> {
  return reliablePublishControls(documentRef).map((element) => ({ label: controlLabel(element), enabled: true }));
}

function reliablePublishControls(documentRef: Document): Array<HTMLButtonElement | HTMLInputElement> {
  return Array.from(documentRef.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input[type=submit], input[type=button]"))
    .filter(visible)
    .filter((element) => ["submit", "button"].includes(element.type) && !element.disabled && element.getAttribute("aria-disabled") !== "true" && element.getAttribute("aria-busy") !== "true")
    .filter((element) => /^(?:publish(?:\s+(?:post|article))?|post(?:\s+article)?)$/i.test(controlLabel(element)));
}

export function findUniqueBlogPublishControl(documentRef: Document = document): HTMLButtonElement | HTMLInputElement | null {
  const selector = getSiteAdapter(documentRef.location?.href || '')?.config.editor?.publishSelector;
  const controls = reliablePublishControls(documentRef).filter(element => !selector || element.matches(selector));
  return controls.length === 1 ? controls[0] : null;
}

export function observeBlogWorkflow(documentRef: Document = document, url = documentRef.location?.href || ""): BlogWorkflowObservation {
  const publicationAdapter = getSiteAdapter(url)?.config.publication || DEFAULT_PUBLICATION_ADAPTER;
  const body = documentRef.body?.innerText || documentRef.body?.textContent || "";
  const text = lower(body);
  const authenticationEvidence = !hasPassword(documentRef) && Array.from(documentRef.querySelectorAll('a[href], button'))
    .some(element => visible(element) && /^(?:log\s*out|sign\s*out|my\s*account|account\s+settings)$/i.test(controlLabel(element)));
  const pathname = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  const login = actionFor(documentRef, url, /\b(?:login|log\s*in|sign\s*in)\b/i, "login");
  const signup = actionFor(documentRef, url, /\b(?:sign\s*up|register|create\s+(?:a\s+)?(?:blog|account))\b/i, "signup");
  const accountMessages = Array.from(documentRef.querySelectorAll('[role=status], [role=alert], .alert, h1, h2, p, div'))
    .filter(visible).filter(e => !e.closest('form,article') && !e.querySelector('form,article,div,p') && (e.textContent || '').length < 500)
    .map(e => lower(e.textContent || ''));
  const registrationEvidence = accountMessages.some(message => !/\b(?:not|failed|unable|unsuccessful)\b/.test(message)
    && /\b(?:account|registration)\s+(?:(?:has\s+been|was|is)\s+)?(?:(?:successfully|succesfuly)\s+)?(?:created|completed|successful|verified)\b/.test(message));
  const verificationRequired = accountMessages.some(message => /\b(?:verify|confirm|activate)\s+(?:your\s+)?(?:email|account)\b|\bcheck\s+your\s+(?:email|inbox)\b|\b(?:activation|verification)\s+(?:email|link)\s+(?:has\s+been\s+)?sent\b/.test(message));
  const newPost = actionFor(documentRef, url, /\b(?:new\s+post|create\s+(?:a\s+)?(?:post|article)|write\s+(?:a\s+)?(?:post|article))\b/i, "new-post");
  const successLinks = publicationAdapter.successLinkSelector
    ? Array.from(documentRef.querySelectorAll<HTMLAnchorElement>(publicationAdapter.successLinkSelector)).filter(visible)
      // Bloguetechno renders its configured success marker inside the publisher
      // form. Article/editor content remains excluded; generic prose below still
      // cannot establish publication from inside a form.
      .filter(element => !element.closest('article, [contenteditable=true]')) : [];
  const confirmationLinks = (successLinks.length ? successLinks : Array.from(documentRef.querySelectorAll<HTMLAnchorElement>("a[href]")))
    .filter(visible)
    .map((element) => ({ label: lower(controlLabel(element)), href: publicArticleUrl(element.getAttribute("href") || "", url) }))
    .filter((candidate) => candidate.href && publicationAdapter.visitLabels.includes(candidate.label));
  const publicUrls = [...new Set(confirmationLinks.map((link) => link.href!))];
  const confirmedSuccessLink = successLinks.length === 1 && confirmationLinks.length === 1;
  // Reusable structural adapter: inspect local messages, never whole-page prose
  // which could mistake article text or navigation for a success notice.
  const publicationEvidence = confirmedSuccessLink
    || Array.from(documentRef.querySelectorAll(publicationAdapter.messageSelector))
    .filter(visible)
    .filter(element => !element.closest('article, form, [contenteditable=true]') && (element.textContent || '').length < 500
      && !element.querySelector('article, form, h1, h2, p, div'))
    .some((element) => {
      const message = lower(element.textContent || "");
      return !/\b(?:not|failed|unsuccessful|pending|draft)\b/.test(message)
        && /\b(?:article|post)\s+(?:(?:has\s+been|was|is)\s+)?(?:successfully\s+)?(?:published|posted)\b/.test(message);
    });

  // Bloguetechno keeps its editor after success. Its configured, unique visible
  // Visit marker is stronger evidence than residual editor DOM; generic prose
  // still cannot override an editor. Run/receipt/content checks remain downstream.
  if (publicationEvidence && (confirmedSuccessLink || !hasEditor(documentRef)) && !hasPassword(documentRef)) {
    return { stage: "CONFIRMATION", confidence: 0.95, publicationEvidence: true, publicUrl: publicUrls.length === 1 ? publicUrls[0] : undefined, reason: publicUrls.length === 1 ? "Explicit publication confirmation and plausible public Visit link recognized" : "Publication confirmed but public article link is missing, rejected, or ambiguous" };
  }
  if (verificationRequired) return { stage: "ACCOUNT_VERIFICATION", confidence: 0.95, reason: "Explicit account/email verification checkpoint recognized" };
  if (hasEditor(documentRef) && (hasTitleField(documentRef) || /\b(?:title|article|post|publish|source)\b/i.test(text))) {
    const controls = publishControls(documentRef);
    return { stage: "EDITOR", confidence: 0.95, authenticationEvidence, titleFieldPresent: hasTitleField(documentRef), editorPresent: true, publishControl: { count: controls.length, label: controls.length === 1 ? controls[0].label : undefined, enabled: controls.length === 1 ? controls[0].enabled : false }, reason: "Rich article editor controls recognized" };
  }
  if (!hasPassword(documentRef) && newPost && /\b(?:log\s*out|logout|my\s*account|all\s+posts|account\s+settings|dashboard|posts)\b/i.test(text)) {
    return { stage: "AUTHENTICATED_DASHBOARD", confidence: 0.95, authenticationEvidence, action: newPost, reason: "Authenticated dashboard and unique new-post action recognized" };
  }
  const registrationControls = Array.from(documentRef.querySelectorAll('button,input[type=submit]')).filter(visible)
    .filter(control => /^(?:register|sign\s*up|create\s+(?:an?\s+)?account)$/i.test(controlLabel(control)));
  if (hasPassword(documentRef) && registrationControls.length) return { stage: "SIGNUP", confidence: 0.95, loginAction: login,
    registrationError: Array.from(documentRef.querySelectorAll('[role=alert],.error,.alert-danger')).filter(visible).some(e => /already|exists|invalid|failed|denied/i.test(e.textContent || '')), reason: "Native registration form and explicit registration control recognized" };
  if (hasPassword(documentRef) && (/\b(?:login|log\s*in|sign\s*in)\b/i.test(text) || Array.from(documentRef.querySelectorAll('button, input[type=submit]')).some(control => visible(control) && /^(?:login|log\s*in|sign\s*in)$/i.test(controlLabel(control))))) return { stage: "LOGIN", confidence: 0.9,
    loginError: Array.from(documentRef.querySelectorAll('[role=alert], .error, .alert-danger, .login-error')).filter(visible)
      .some(element => /invalid|incorrect|failed|denied|not match|not found|try again/i.test(element.textContent || "")), registrationEvidence, reason: "Login form recognized" };
  if (hasPassword(documentRef) && /\b(?:sign\s*up|register|create\s+account)\b/i.test(text)) return { stage: "SIGNUP", confidence: 0.9, loginAction: login, reason: "Signup form recognized" };
  if (registrationEvidence) return { stage: "ACCOUNT_CREATED", confidence: 0.95, registrationEvidence: true, loginAction: login, reason: "Explicit account-created evidence recognized" };
  if (pathname === "/" && (login || signup)) return { stage: "HOMEPAGE", confidence: 0.9, action: login || signup, loginAction: login, signupAction: signup, reason: "Blog homepage authentication action recognized" };
  return { stage: "UNSUPPORTED", confidence: 0, reason: "No unambiguous blog workflow structure recognized" };
}
