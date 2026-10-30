export const AMP_BLOGS_ORIGIN = "https://ampblogs.com";

export const AMP_BLOGS_PAGE_STATES = Object.freeze({
  HOMEPAGE: "HOMEPAGE",
  SIGNUP_FORM: "SIGNUP_FORM",
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  LOGIN_FORM: "LOGIN_FORM",
  AUTHENTICATED_DASHBOARD: "AUTHENTICATED_DASHBOARD",
  AUTH_ERROR: "AUTH_ERROR",
  UNSUPPORTED: "UNSUPPORTED",
});

// These selectors are intentionally limited to stable, semantic page signals. They are
// observation locators only; no locator in this module is used to fill, check, or click.
export const AMP_BLOGS_LOCATORS = Object.freeze({
  signupNavigation: [
    'a[href*="/signup" i]', 'a[href*="/register" i]', 'a[href*="/create-account" i]',
    'a:has-text("Sign Up")', 'a:has-text("Register")', 'a:has-text("Start Now")',
  ],
  loginNavigation: [
    'a[href*="/login" i]', 'a[href*="/signin" i]', 'a[href*="/sign-in" i]',
    'a:has-text("Log In")', 'a:has-text("Login")', 'a:has-text("Sign In")',
  ],
  username: [
    'input[name="username" i]', 'input[id*="username" i]', 'input[autocomplete="username" i]',
    'input[name*="user-name" i]', 'input[name*="user_name" i]',
  ],
  password: ['input[type="password" i]', 'input[name*="password" i]', 'input[id*="password" i]'],
  email: [
    'input[type="email" i]', 'input[name="email" i]', 'input[id*="email" i]',
    'input[autocomplete="email" i]',
  ],
  captchaContainer: [
    'div.captcha-register', 'div#KEY-Captcha',
  ],
  captchaImage: [
    'img[id*="captcha" i]', 'img[src*="captcha.php" i]', 'img[alt*="captcha" i]',
  ],
  captchaAnswer: [
    'input[name="captcha" i]', 'input[id*="captcha" i]', 'input[placeholder*="captcha" i]',
  ],
  termsCheckbox: [
    'input[type="checkbox"][name*="term" i]', 'input[type="checkbox"][id*="term" i]',
    'input[type="checkbox"][name*="agree" i]', 'input[type="checkbox"][id*="agree" i]',
  ],
  signInButton: [
    'button.sign-in-button', 'button[name="login" i]', 'button[name="signin" i]',
    'button[name="sign_in" i]', 'button[name="sign-in" i]',
    'input[type="submit"][name="login" i]', 'input[type="submit"][name="signin" i]',
    'input[type="submit"][name="sign_in" i]', 'input[type="submit"][name="sign-in" i]',
  ],
});

const OAUTH_CONTROL_PATTERN = /(?:sign[\s-]?in|log[\s-]?in|login|connect|continue|register|create[\s-]?account).*(?:with|using|via)\s+(?:google|facebook|twitter|x|github|linkedin|apple|yahoo|microsoft)|(?:google|facebook|twitter|x|github|linkedin|apple|yahoo|microsoft).*(?:sign[\s-]?in|log[\s-]?in|login|connect|continue|register|create[\s-]?account)|sign[\s-]?in[\s-]?with|log[\s-]?in[\s-]?with/i;

export function isOAuthControlText(value) {
  return OAUTH_CONTROL_PATTERN.test(normalized(value));
}

function isOAuthLink(link) {
  const signal = `${link.text || ""} ${link.className || ""} ${link.selector || ""} ${link.href || ""}`;
  return isOAuthControlText(signal)
    || /(?:^|[\s_-])(?:google|facebook|twitter|x|github|linkedin|apple|yahoo|microsoft)(?:[\s_-]|$)/i.test(link.className || "")
      && /(?:oauth|sign|login|register|account|#)/i.test(`${link.href || ""} ${link.className || ""}`);
}

export function isPrimarySignInControl(element) {
  if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement)) return false;
  if (element.type !== "submit" && element.type !== "button") return false;
  if (element.disabled) return false;
  const text = normalized(`${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("value") || ""}`);
  const identity = normalized(`${element.getAttribute("name") || ""} ${element.id} ${element.getAttribute("class") || ""}`);
  if (isOAuthControlText(`${text} ${identity}`)) return false;
  const form = element.form || element.closest("form");
  if (form) {
    const controls = Array.from(form.querySelectorAll("input, textarea, select"));
    const hasPassword = controls.some((control) => control instanceof HTMLInputElement && control.type === "password");
    const hasIdentifier = controls.some((control) => /(?:username|user[ _-]?name|email|login)/i.test(`${control.getAttribute("name") || ""} ${control.id} ${control.getAttribute("autocomplete") || ""}`));
    if (!hasPassword || !hasIdentifier) return false;
  }
  return /(?:^|[\s_-])(?:sign[\s_-]?in|log[\s_-]?in|login)(?:[\s_-]|$)/i.test(text)
    || /(?:^|[\s_-])(?:sign[\s_-]?in|log[\s_-]?in|login)(?:[\s_-]|$)/i.test(identity);
}

export async function resolvePrimarySignInControl(page) {
  const candidates = page.locator("button, input[type=submit], input[type=button]");
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible()) continue;
    if (!await candidate.isEnabled()) continue;
    if (await candidate.evaluate(isPrimarySignInControl)) return { found: true, selector: await candidate.evaluate((element) => element.id ? `#${element.id}` : element.getAttribute("name") ? `${element.tagName.toLowerCase()}[name="${element.getAttribute("name")}"]` : element.tagName.toLowerCase()) };
  }
  return { found: false };
}

function normalized(value) { return String(value || "").replace(/\s+/g, " ").trim(); }

function lower(value) { return normalized(value).toLowerCase(); }

function safeHref(value, base = AMP_BLOGS_ORIGIN) {
  if (!value || /^\s*(?:#|javascript:)/i.test(String(value))) return "";
  try {
    const url = new URL(value, base);
    if (url.origin !== AMP_BLOGS_ORIGIN) return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function fieldText(field) {
  return lower(`${field.name} ${field.id} ${field.placeholder} ${field.label} ${field.autocomplete}`);
}

function hasField(fields, pattern, type) {
  return fields.some((field) => (!type || lower(field.type) === type) && pattern.test(fieldText(field)));
}

function hasVisible(fields, predicate) { return fields.some((field) => field.visible && !field.disabled && predicate(field)); }

function isAccountCreated({ url, title, bodyText }) {
  return /(?:account|registration|sign[- ]?up).*(?:created|complete|success)|welcome.*(?:account|aboard)/i.test(`${url} ${title} ${bodyText}`)
    || /\/(?:account-created|registration-success|signup-success|welcome)(?:[/?#]|$)/i.test(url);
}

function isAuthenticatedDashboard({ url, title, bodyText, fields }) {
  const text = lower(`${title} ${bodyText}`);
  const path = (() => { try { return new URL(url, AMP_BLOGS_ORIGIN).pathname; } catch { return ""; } })();
  const dashboardPath = /\/(?:dashboard|account|my-account|profile|member)(?:[/?#]|$)/i.test(path);
  const authenticatedCue = /(?:log\s*out|logout|sign\s*out|my\s*account|new\s*article|new\s*post|account\s*settings)/i.test(text);
  const authForm = hasVisible(fields, (field) => lower(field.type) === "password");
  return !authForm && (dashboardPath && authenticatedCue || authenticatedCue && /\bdashboard\b/i.test(text));
}

function isAuthError({ url, title, bodyText }) {
  const pageText = `${url} ${title}`;
  const authPath = /\/(?:login|signin|sign-in|signup|register|create-account|account|auth-error)(?:[/?#]|$)/i.test(url);
  const errorCue = /(?:invalid|incorrect|unable|already\s+(?:exists|registered|taken)|login\s+failed|sign\s+in\s+failed|registration\s+failed|account\s+creation\s+failed|try\s+again|error)/i.test(bodyText);
  return authPath && errorCue && !isAuthenticatedDashboard({ url, title, bodyText, fields: [] });
}

function isHomepage({ url, bodyText, title, fields }) {
  try {
    const parsed = new URL(url, AMP_BLOGS_ORIGIN);
    return parsed.origin === AMP_BLOGS_ORIGIN && parsed.pathname === "/" && !hasVisible(fields, (field) => lower(field.type) === "password")
      && !/account created|registration complete/i.test(`${title} ${bodyText}`);
  } catch { return false; }
}

function pageState(snapshot, { hasSignup, hasLogin, signupForm, loginForm } = {}) {
  if (isAccountCreated(snapshot)) return AMP_BLOGS_PAGE_STATES.ACCOUNT_CREATED;
  if (isAuthenticatedDashboard(snapshot)) return AMP_BLOGS_PAGE_STATES.AUTHENTICATED_DASHBOARD;
  if (isAuthError(snapshot)) return AMP_BLOGS_PAGE_STATES.AUTH_ERROR;
  if (signupForm) return AMP_BLOGS_PAGE_STATES.SIGNUP_FORM;
  if (loginForm) return AMP_BLOGS_PAGE_STATES.LOGIN_FORM;
  if (isHomepage(snapshot)) return AMP_BLOGS_PAGE_STATES.HOMEPAGE;
  return AMP_BLOGS_PAGE_STATES.UNSUPPORTED;
}

function matchingLinks(links, patterns) {
  return links.filter((link) => link.href && !isOAuthLink(link) && link.visible !== false && patterns.some((pattern) => pattern.test(link.href) || pattern.test(link.text)));
}

function locatorDescriptors(links, fields, bodyText, captchaElements = []) {
  const signupLinks = matchingLinks(links, [/\/signup(?:$|[?#])/i, /\/register(?:$|[?#])/i, /\/create-account(?:$|[?#])/i]);
  const loginLinks = matchingLinks(links, [/\/login(?:$|[?#])/i, /\/signin(?:$|[?#])/i, /\/sign-in(?:$|[?#])/i]);
  const field = (kind, predicate) => fields.filter((item) => item.visible && !item.disabled && predicate(item)).map((item) => ({ kind, selector: item.selector, type: item.type }));
  const control = (kind, predicate) => fields.filter((item) => item.visible && !item.disabled && predicate(item)).map((item) => ({ kind, selector: item.selector, type: item.type }));
  const captchaContainer = captchaElements.filter((item) => item.visible && item.kind === "captchaContainer").map(({ kind, selector, type }) => ({ kind, selector, type }));
  const captchaImage = captchaElements.filter((item) => item.visible && item.kind === "captchaImage").map(({ kind, selector, type }) => ({ kind, selector, type }));
  const captchaAnswer = [
    ...control("captchaAnswer", (item) => /captcha/i.test(fieldText(item)) && item.type !== "div" && item.type !== "img"),
    ...captchaElements.filter((item) => item.visible && item.kind === "captchaAnswer").map(({ kind, selector, type }) => ({ kind, selector, type })),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.selector === item.selector) === index);
  const signInButton = links.filter((link) => !link.href
    && !isOAuthControlText(`${link.text} ${link.selector}`)
    && (!link.type || link.type === "submit" || link.type === "button")
    && (!link.form || (link.form.hasPassword && link.form.hasIdentifier))
    && /(?:^|\s)(?:sign\s*in|log\s*in|login)(?:\s|$)/i.test(link.text))
    .map((link) => ({ selector: link.selector, text: normalized(link.text), href: safeHref(link.href) }));
  const text = lower(bodyText);
  return {
    signupNavigation: signupLinks.map((link) => ({ selector: link.selector, text: normalized(link.text), href: safeHref(link.href) })),
    loginNavigation: loginLinks.map((link) => ({ selector: link.selector, text: normalized(link.text), href: safeHref(link.href) })),
    username: field("username", (item) => /\b(?:user(?:name)?|login\s*name|account\s*name|user\s*id)\b/i.test(fieldText(item))),
    password: field("password", (item) => lower(item.type) === "password" || /password/i.test(fieldText(item))),
    email: field("email", (item) => lower(item.type) === "email" || /\bemail\b/i.test(fieldText(item))),
    captcha: {
      present: captchaContainer.length > 0 || captchaImage.length > 0 || captchaAnswer.length > 0
        || /captcha|assemble the puzzle|cloudflare|verify you are human|security check/i.test(text)
        || fields.some((item) => /captcha/i.test(fieldText(item))),
      container: captchaContainer,
      image: captchaImage,
      answer: captchaAnswer,
    },
    termsCheckbox: field("terms", (item) => lower(item.type) === "checkbox" && /terms?|conditions?|agree/i.test(fieldText(item))),
    signInButton,
  };
}

export function detectAmpBlogsPage({ url = "", title = "", bodyText = "", links = [], fields = [], captchaElements = [] } = {}) {
  const text = `${title} ${bodyText}`.toLowerCase();
  const sameOriginLinks = links.filter((link) => !link.href || (() => {
    try { return new URL(link.href, AMP_BLOGS_ORIGIN).origin === AMP_BLOGS_ORIGIN; } catch { return false; }
  })());
  const safeLinks = sameOriginLinks.map((link) => ({ ...link, text: normalized(link.text), selector: link.selector || "a" }));
  const navigableLinks = safeLinks.filter((link) => link.href);
  const authLinks = navigableLinks.filter((link) => !isOAuthLink(link));
  const hasSignup = authLinks.some((link) => /\/signup(?:$|[?#])/i.test(link.href) || /sign\s*up|start now|register/i.test(link.text));
  const hasLogin = authLinks.some((link) => /\/login(?:$|[?#])/i.test(link.href) || /login|sign\s*in/i.test(link.text));
  const authFields = fields.filter((field) => !/captcha|remember\s*me/i.test(fieldText(field)));
  const captcha = /captcha|assemble the puzzle|cloudflare|verify you are human|security check/.test(text) || fields.some((field) => /captcha/i.test(`${field.name} ${field.id} ${field.label}`));
  const terms = fields.some((field) => field.type === "checkbox" && /terms?|conditions?|agree/i.test(`${field.name} ${field.id} ${field.label}`));
  const loginForm = hasField(authFields, /\b(?:username|user\s*name|email|login)\b/i) && hasField(authFields, /password/i) && /login|sign\s*in|log\s*in/i.test(text);
  const signupPath = /\/(?:signup|register|create-account)(?:[/?#]|$)/i.test(url);
  const signupForm = authFields.some((field) => /\b(?:username|user\s*name|account\s*name)\b/i.test(lower(`${field.name} ${field.id} ${field.placeholder} ${field.label}`)))
    && hasField(authFields, /password/i) && hasField(authFields, /\bemail\b/i)
    && (signupPath || /sign\s*up|create\s+account|registration/i.test(text));
  const snapshot = { url, title, bodyText, fields };
  const state = pageState(snapshot, { hasSignup, hasLogin, signupForm, loginForm });
  return {
    url,
    title: normalized(title),
    pageState: state,
    hasSignup: hasSignup || signupForm,
    hasLogin: hasLogin || loginForm,
    captcha,
    terms,
    fields: fields.map(({ name = "", id = "", type = "", placeholder = "", label = "", autocomplete = "", selector = "", visible = false, disabled = false }) => ({ name, id, type, placeholder, label, autocomplete, selector, visible, disabled })),
    locators: locatorDescriptors(safeLinks, fields, bodyText, captchaElements),
    unsupported: state === AMP_BLOGS_PAGE_STATES.UNSUPPORTED,
  };
}

async function inspectCurrentPage(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      return !element.hidden && style.display !== "none" && style.visibility !== "hidden";
    };
    const labels = (element) => element.labels ? Array.from(element.labels).map((label) => label.textContent || "").join(" ").replace(/\s+/g, " ").trim() : "";
    const fields = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable=\"true\"]")).map((element) => ({
      name: element.getAttribute("name") || "",
      id: element.id || "",
      type: element.getAttribute("type") || element.tagName.toLowerCase(),
      placeholder: element.getAttribute("placeholder") || "",
      label: labels(element) || element.getAttribute("aria-label") || "",
      autocomplete: element.getAttribute("autocomplete") || "",
      selector: element.id ? `#${element.id}` : element.getAttribute("name") ? `${element.tagName.toLowerCase()}[name="${element.getAttribute("name")}"]` : element.tagName.toLowerCase(),
      visible: visible(element),
      disabled: "disabled" in element ? Boolean(element.disabled) : false,
    }));
    const links = Array.from(document.querySelectorAll("a[href], button, input[type=submit], input[type=button], [role=button]")).map((element) => {
      const anchor = element.tagName.toLowerCase() === "a" ? element : element.closest("a[href]");
      const form = element.closest("form");
      const formControls = form ? Array.from(form.querySelectorAll("input, textarea, select")) : [];
      return {
        text: element.textContent || element.getAttribute("aria-label") || element.getAttribute("value") || "",
        href: element.getAttribute("href") || anchor?.getAttribute("href") || "",
        type: element.getAttribute("type") || "",
        className: typeof element.className === "string" ? element.className : "",
        form: form ? {
          hasPassword: formControls.some((control) => control instanceof HTMLInputElement && control.type === "password"),
          hasIdentifier: formControls.some((control) => /(?:username|user[ _-]?name|email|login)/i.test(`${control.getAttribute("name") || ""} ${control.id} ${control.getAttribute("autocomplete") || ""}`)),
        } : null,
        selector: element.id ? `#${element.id}` : element.getAttribute("name") ? `${element.tagName.toLowerCase()}[name="${element.getAttribute("name")}"]` : element.tagName.toLowerCase(),
        visible: visible(element),
      };
    });
    const captchaSignal = (element) => `${element.id || ""} ${typeof element.className === "string" ? element.className : ""} ${element.getAttribute("data-sitekey") || ""}`;
    const captchaElements = Array.from(document.querySelectorAll("[id*='captcha' i], [class*='captcha' i], [id*='puzzle' i], [class*='puzzle' i], [data-sitekey], img[src*='captcha' i], input[name*='captcha' i], input[id*='captcha' i]"))
      .filter(visible)
      .map((element) => {
        const tag = element.tagName.toLowerCase();
        const ownSignal = `${captchaSignal(element)} ${element.getAttribute("src") || ""} ${element.getAttribute("alt") || ""}`;
        const isAnswer = /^(input|textarea|select)$/.test(tag) && /captcha/i.test(ownSignal);
        const imageSignal = `${element.id || ""} ${typeof element.className === "string" ? element.className : ""} ${element.getAttribute("alt") || ""}`;
        const isImage = tag === "img" && (/captcha/i.test(imageSignal) || /captcha\.php(?:[?#]|$)/i.test(element.getAttribute("src") || ""));
        const parentHasCaptchaSignal = element.parentElement ? /captcha|puzzle/i.test(captchaSignal(element.parentElement)) : false;
        const isContainer = !/^(img|input|textarea|select)$/.test(tag) && /captcha|puzzle/i.test(captchaSignal(element)) && !parentHasCaptchaSignal;
        if (!isAnswer && !isImage && !isContainer) return null;
        return {
          kind: isAnswer ? "captchaAnswer" : isImage ? "captchaImage" : "captchaContainer",
          selector: element.id ? `#${element.id}` : element.getAttribute("name") ? `${tag}[name="${element.getAttribute("name")}"]` : element.className ? `${tag}.${String(element.className).split(/\s+/)[0]}` : tag,
          type: tag === "input" ? element.getAttribute("type") || "text" : tag,
          visible: true,
        };
      }).filter(Boolean)
      .filter((item, index, items) => items.findIndex((candidate) => candidate.kind === item.kind && candidate.selector === item.selector) === index);
    return { url: location.href, title: document.title, bodyText: document.body?.innerText || "", links, fields, captchaElements };
  }).then((snapshot) => detectAmpBlogsPage(snapshot));
}

export async function inspectPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  return inspectCurrentPage(page);
}

export function ampBlogsLocators(page) {
  return Object.fromEntries(Object.entries(AMP_BLOGS_LOCATORS).map(([name, selectors]) => [name, page.locator(selectors.join(", "))]));
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (!await candidate.isVisible()) continue;
      const candidateText = await candidate.evaluate((element) => `${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("class") || ""} ${element.getAttribute("href") || ""}`);
      if (isOAuthControlText(candidateText)) continue;
      return candidate;
    }
  }
  return null;
}

const NAVIGATION_TARGETS = Object.freeze({
  signup: { state: AMP_BLOGS_PAGE_STATES.SIGNUP_FORM, selectors: AMP_BLOGS_LOCATORS.signupNavigation, path: /\/(?:signup|register|create-account)(?:[/?#]|$)/i },
  login: { state: AMP_BLOGS_PAGE_STATES.LOGIN_FORM, selectors: AMP_BLOGS_LOCATORS.loginNavigation, path: /\/(?:login|signin|sign-in)(?:[/?#]|$)/i },
});

export async function navigateAmpBlogsPage(page, target, { timeout = 15000 } = {}) {
  const destination = NAVIGATION_TARGETS[target];
  if (!destination) throw new Error(`Unsupported AmpBlogs navigation target: ${target}`);
  const current = await inspectCurrentPage(page);
  if (![AMP_BLOGS_PAGE_STATES.HOMEPAGE, AMP_BLOGS_PAGE_STATES.SIGNUP_FORM, AMP_BLOGS_PAGE_STATES.LOGIN_FORM].includes(current.pageState)) {
    throw new Error(`Guarded AmpBlogs navigation stopped from page state ${current.pageState}.`);
  }
  const link = await firstVisibleLocator(page, destination.selectors);
  if (!link) throw new Error(`No visible AmpBlogs ${target} navigation link was recognized.`);
  const href = await link.getAttribute("href");
  if (!href || /^\s*(?:javascript:|#)/i.test(href)) throw new Error(`AmpBlogs ${target} navigation link has no safe HTTP destination.`);
  const nextUrl = new URL(href, page.url());
  if (nextUrl.origin !== AMP_BLOGS_ORIGIN || !destination.path.test(nextUrl.pathname)) {
    throw new Error(`AmpBlogs ${target} navigation link did not resolve to a supported same-origin destination.`);
  }
  await page.goto(nextUrl.href, { waitUntil: "domcontentloaded", timeout });
  const observed = await inspectCurrentPage(page);
  if (observed.pageState !== destination.state && observed.pageState !== AMP_BLOGS_PAGE_STATES.UNSUPPORTED) {
    throw new Error(`AmpBlogs ${target} navigation reached unexpected page state ${observed.pageState}.`);
  }
  return observed;
}

export async function observeAmpBlogs(context, homeUrl = AMP_BLOGS_ORIGIN) {
  const page = await context.newPage();
  const homepage = await inspectPage(page, homeUrl);
  const targets = [];
  if (homepage.locators.signupNavigation.length > 0) targets.push("signup");
  if (homepage.locators.loginNavigation.length > 0) targets.push("login");
  const pages = { homepage };
  const inspectedPaths = [new URL(homepage.url || homeUrl, AMP_BLOGS_ORIGIN).pathname];
  for (const target of targets) {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    const observed = await navigateAmpBlogsPage(page, target);
    pages[target] = observed;
    inspectedPaths.push(new URL(observed.url, AMP_BLOGS_ORIGIN).pathname);
  }
  return { pages, inspectedPaths: [...new Set(inspectedPaths)] };
}

export { inspectCurrentPage };
