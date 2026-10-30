export const AMP_BLOGS_HOST = "ampblogs.com";

export type AmpBlogsPageState =
  | "HOMEPAGE"
  | "SIGNUP_FORM"
  | "ACCOUNT_CREATED"
  | "LOGIN_FORM"
  | "AUTHENTICATED_DASHBOARD"
  | "AUTH_ERROR"
  | "UNSUPPORTED";

export interface AmpBlogsObservation {
  supported: boolean;
  pageState: AmpBlogsPageState;
  url: string;
  title: string;
  loginHref?: string;
  signupHref?: string;
  startNowHref?: string;
  captcha: boolean;
  captchaState: "absent" | "present" | "verified";
  terms: boolean;
  reason?: string;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lower(value: string): string {
  return normalized(value).toLowerCase();
}

function isAmpBlogsHost(hostname: string): boolean {
  return hostname.toLowerCase().replace(/^www\./, "") === AMP_BLOGS_HOST;
}

export function isAmpBlogsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol) && isAmpBlogsHost(url.hostname);
  } catch {
    return false;
  }
}

function safeSameOriginHref(value: string, baseUrl: string): string | undefined {
  if (!value || /^\s*(?:#|javascript:)/i.test(value)) return undefined;
  try {
    const base = new URL(baseUrl);
    const target = new URL(value, base);
    if (!/^https?:$/i.test(target.protocol) || !isAmpBlogsHost(target.hostname)) return undefined;
    target.hash = "";
    return target.href;
  } catch {
    return undefined;
  }
}

function isOAuthControl(value: string): boolean {
  return /(?:sign[\s-]?in|log[\s-]?in|login|connect|continue|register|create[\s-]?account).*(?:with|using|via)\s+(?:google|facebook|twitter|x|github|linkedin|apple|yahoo|microsoft)|(?:google|facebook|twitter|x|github|linkedin|apple|yahoo|microsoft).*(?:sign[\s-]?in|log[\s-]?in|login|connect|continue|register|create[\s-]?account)|sign[\s-]?in[\s-]?with|log[\s-]?in[\s-]?with/i.test(value);
}

function captchaStateFor(documentRef: Document, bodyText: string): "absent" | "present" | "verified" {
  const challengeElements = Array.from(documentRef.querySelectorAll(
    '[id*="captcha" i], [class*="captcha" i], [id*="puzzle" i], [class*="puzzle" i], [data-sitekey], iframe[src*="captcha" i], input[name*="captcha" i], textarea[name*="captcha" i]',
  )).filter(isVisible);
  const ampBlogsValidPuzzle = documentRef.querySelector("#validPuzzle");
  const explicitSuccess = documentRef.querySelector(
    '[data-captcha-verified="true" i], [data-verified="true" i], [aria-validated="true" i], .captcha-verified, .captcha-success, .captcha-passed',
  );
  const responseToken = Array.from(documentRef.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[name="g-recaptcha-response"], textarea[name="g-recaptcha-response"], input[name="h-captcha-response"], textarea[name="h-captcha-response"]',
  )).some((field) => field.value.trim().length > 0);
  if (explicitSuccess || responseToken || ampBlogsValidPuzzle && isVisible(ampBlogsValidPuzzle) || /captcha\s+(?:verified|passed|complete|success)/i.test(bodyText)) return "verified";
  if (challengeElements.length || /captcha|assemble the puzzle|cloudflare|verify you are human|security check/i.test(bodyText)) return "present";
  return "absent";
}

export function findAmpBlogsLoginSubmit(documentRef: Document = document): HTMLButtonElement | HTMLInputElement | null {
  const candidates = Array.from(documentRef.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input[type=submit], input[type=button]"))
    .filter((element) => {
      if (!isVisible(element) || element.disabled) return false;
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (type !== "submit" && type !== "button") return false;
      const text = lower(`${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("value") || ""}`);
      const identity = lower(`${element.getAttribute("name") || ""} ${element.id} ${element.getAttribute("class") || ""}`);
      if (isOAuthControl(`${text} ${identity}`)) return false;
      const form = element.form || element.closest("form");
      if (!form) return false;
      const controls = Array.from(form.querySelectorAll("input, textarea, select"));
      const hasPassword = controls.some((control) => lower(control.getAttribute("type") || "") === "password");
      const hasIdentifier = controls.some((control) => /(?:username|user[ _-]?name|email|login)/i.test(fieldText(control)));
      if (!hasPassword || !hasIdentifier) return false;
      return /(?:sign\s*in|log\s*in|login)/i.test(`${text} ${identity}`);
    });
  return candidates.length === 1 ? candidates[0] : null;
}

function isVisible(element: Element): boolean {
  if (element.hasAttribute("hidden")) return false;
  const view = element.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(element);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

function fieldText(element: Element): string {
  const labelledElement = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const labels = Array.from(labelledElement.labels || []).map((label) => label.textContent || "").join(" ");
  const labelledBy = (element.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => element.ownerDocument?.getElementById(id)?.textContent || "")
    .join(" ");
  return lower([
    element.getAttribute("name") || "",
    element.id,
    element.getAttribute("type") || "",
    element.getAttribute("placeholder") || "",
    element.getAttribute("autocomplete") || "",
    element.getAttribute("aria-label") || "",
    labels,
    labelledBy,
  ].join(" "));
}

function collectFields(documentRef: Document): Element[] {
  return Array.from(documentRef.querySelectorAll("input, textarea, select")).filter((element) => {
    const input = element as HTMLInputElement;
    return isVisible(element) && !input.disabled && input.type !== "hidden";
  });
}

function hasField(fields: Element[], pattern: RegExp, type?: string): boolean {
  return fields.some((field) => {
    const actualType = lower(field.getAttribute("type") || field.tagName);
    return (!type || actualType === type) && pattern.test(fieldText(field));
  });
}

function pagePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function isAccountCreated(url: string, title: string, bodyText: string): boolean {
  return /(?:account|registration|sign[- ]?up).*(?:created|complete|success)|welcome.*(?:account|aboard)/i.test(`${url} ${title} ${bodyText}`)
    || /\/(?:account-created|registration-success|signup-success|welcome)(?:[/?#]|$)/i.test(url);
}

function isAuthenticatedDashboard(url: string, title: string, bodyText: string, fields: Element[]): boolean {
  const text = lower(`${title} ${bodyText}`);
  const path = pagePath(url);
  const dashboardPath = /\/(?:dashboard|account|my-account|profile|member)(?:[/?#]|$)/i.test(path);
  const authenticatedCue = /(?:log\s*out|logout|sign\s*out|my\s*account|new\s*article|new\s*post|account\s*settings)/i.test(text);
  const authForm = hasField(fields, /password/i, "password");
  return !authForm && ((dashboardPath && authenticatedCue) || (authenticatedCue && /\bdashboard\b/i.test(text)));
}

function isAuthError(url: string, bodyText: string): boolean {
  const authPath = /\/(?:login|signin|sign-in|signup|register|create-account|account|auth-error)(?:[/?#]|$)/i.test(url);
  const errorCue = /(?:invalid|incorrect|unable|already\s+(?:exists|registered|taken)|login\s+failed|sign\s+in\s+failed|registration\s+failed|try\s+again|error)/i.test(bodyText);
  return authPath && errorCue;
}

function findAuthHref(documentRef: Document, kind: "login" | "signup", url: string): string | undefined {
  const pathPattern = kind === "login" ? /\/(?:login|signin|sign-in)(?:[/?#]|$)/i : /\/(?:signup|register|create-account)(?:[/?#]|$)/i;
  const textPattern = kind === "login" ? /login|sign\s*in|log\s*in/i : /sign\s*up|start\s*now|register|create\s*account/i;
  for (const link of Array.from(documentRef.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (!isVisible(link)) continue;
    const href = safeSameOriginHref(link.getAttribute("href") || "", url);
    const signal = `${link.textContent || ""} ${link.getAttribute("aria-label") || ""} ${link.className || ""} ${href || ""}`;
    if (!href || isOAuthControl(signal)) continue;
    if (pathPattern.test(href) || textPattern.test(link.textContent || "")) return href;
  }
  return undefined;
}

function findStartNowHref(documentRef: Document, url: string): string | undefined {
  for (const link of Array.from(documentRef.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (!isVisible(link)) continue;
    const href = safeSameOriginHref(link.getAttribute("href") || "", url);
    const signal = `${link.textContent || ""} ${link.getAttribute("aria-label") || ""} ${link.id} ${link.className || ""}`;
    if (href && /\bstart\s*now\b/i.test(signal) && !isOAuthControl(signal)) return href;
  }
  return undefined;
}

export function observeAmpBlogsPage(documentRef: Document = document, url = documentRef.location?.href || ""): AmpBlogsObservation {
  const title = documentRef.title || "";
  const bodyText = documentRef.body?.innerText || documentRef.body?.textContent || "";
  if (!isAmpBlogsUrl(url)) {
    return { supported: false, pageState: "UNSUPPORTED", url, title: normalized(title), captcha: false, captchaState: "absent", terms: false, reason: "Current tab is not ampblogs.com." };
  }

  const fields = collectFields(documentRef);
  const authFields = fields.filter((field) => !/captcha|remember\s*me/i.test(fieldText(field)));
  const text = lower(`${title} ${bodyText}`);
  const captchaState = captchaStateFor(documentRef, bodyText);
  const captcha = captchaState !== "absent";
  const terms = fields.some((field) => lower(field.getAttribute("type") || "") === "checkbox" && /terms?|conditions?|agree/i.test(fieldText(field)));
  const loginHref = findAuthHref(documentRef, "login", url);
  const signupHref = findAuthHref(documentRef, "signup", url);
  const startNowHref = findStartNowHref(documentRef, url);
  const loginForm = hasField(authFields, /\b(?:username|user\s*name|email|login)\b/i)
    && hasField(authFields, /password/i)
    && /login|sign\s*in|log\s*in/i.test(text);
  const signupForm = authFields.some((field) => /\b(?:username|user\s*name|account\s*name)\b/i.test(fieldText(field)))
    && hasField(authFields, /password/i)
    && hasField(authFields, /\bemail\b/i)
    && (/\/(?:signup|register|create-account)(?:[/?#]|$)/i.test(url) || /sign\s*up|create\s+account|registration/i.test(text));
  const state: AmpBlogsPageState = isAccountCreated(url, title, bodyText)
    ? "ACCOUNT_CREATED"
    : isAuthenticatedDashboard(url, title, bodyText, fields)
      ? "AUTHENTICATED_DASHBOARD"
      : isAuthError(url, bodyText)
        ? "AUTH_ERROR"
        : signupForm
          ? "SIGNUP_FORM"
          : loginForm
            ? "LOGIN_FORM"
            : pagePath(url) === "/" && !hasField(fields, /password/i, "password") && !/account created|registration complete/i.test(text)
              ? "HOMEPAGE"
              : "UNSUPPORTED";

  return { supported: true, pageState: state, url, title: normalized(title), loginHref, signupHref, startNowHref, captcha, captchaState, terms };
}
