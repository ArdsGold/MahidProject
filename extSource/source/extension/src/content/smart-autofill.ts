import type { BusinessProfile } from '@backlink-autofill/shared';
import { isAutomationExcluded } from '@backlink-autofill/shared';
import type { ListingAutofillReport, ListingField } from '../messages';
import { manualAutofillFamily } from '../manual-autofill-policy';
import { isNativeDirectoryHumanControl } from '../automation/native-directory';
import { family2CategoryChoice, fieldValue, setVisibleValue } from './listing-autofill';
import { loginGuardKey, type ListingRun } from '../listing-run';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type SmartField = ListingField | 'address2' | 'mobile' | 'latitude' | 'longitude';
const normalize = (text: string) => text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const blocked = /\b(?:captcha|recaptcha|turnstile|one time|two factor|security code|payment|billing|shipping|credit card|card number|cardholder|expiry|expiration|cvv|cvc|iban|routing|account number|search|query|keyword|coupon|promo|verification|otp|reciprocal|recpr|terms|agreement|consent|image|photo|logo|brochure|youtube|tiktok)\b/;
const purpose: Partial<Record<SmartField, RegExp>> = {
  businessName: /\b(?:business name|company name|organization|organisation|listing title|attachment title)\b/,
  contactName: /\b(?:contact (?:name|person)|your name|owner name|full name)\b/,
  firstName: /\b(?:first name|given name|forename)\b/,
  lastName: /\b(?:last name|family name|surname)\b/,
  email: /\b(?:e mail|email)\b/,
  phone: /\b(?:phone|telephone|tel|contact number)\b/,
  mobile: /\b(?:mobile(?: phone)?|cell(?: phone)?)\b/,
  website: /\b(?:website|web site|homepage|web address|url)\b/,
  description: /\b(?:description|about (?:business|company)|business details|summary|your profile)\b/,
  address: /\b(?:street address|complete address|full address|address line 1)\b|^address$/,
  address2: /\baddress(?: line)? ?2\b/,
  city: /\b(?:city|town)\b/,
  state: /\b(?:state|province|region)\b/,
  postalCode: /\b(?:postal code|postcode|zip(?: code)?)\b/,
  country: /\bcountry\b/,
  category: /\b(?:category|industry|business type)\b/,
  username: /\b(?:username|user name|login name|login id|user id|member name)\b/,
  password: /\b(?:password|passcode)\b/,
  facebook: /\bfacebook\b/,
  linkedin: /\blinked ?in\b/,
  twitter: /\btwitter\b/,
  instagram: /\binstagram\b/,
  businessHours: /\b(?:hours|opening hours|operating hours)\b/,
  latitude: /\blatitude\b|^lat$/,
  longitude: /\blongitude\b|^(?:lng|lon)$/,
};

function text(node: Element | null): string {
  if (!node) return '';
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('input,select,textarea,button').forEach(el => el.remove());
  return normalize(copy.textContent || '');
}
function signals(el: Control): string[] {
  const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => id && text(document.getElementById(id))).join(' ');
  const labels = [...(el.labels || [])].map(text).join(' ');
  const own = normalize([labels, labelled, el.getAttribute('aria-label'), el.getAttribute('placeholder')].filter(Boolean).join(' '));
  const attributes = normalize([el.name, el.id, el.getAttribute('autocomplete')].filter(Boolean).join(' '));
  const previous = el.previousElementSibling;
  const wrapper = el.closest('.field,.form-group,td');
  const nearby = [previous && !previous.matches('input,select,textarea,button') && !previous.querySelector('input,select,textarea,button')
    && (!previous.hasAttribute('for') || previous.getAttribute('for') === el.id) ? text(previous) : '',
    wrapper && wrapper.querySelectorAll('input,select,textarea').length === 1 ? text(wrapper) : ''].filter(value => value.length <= 100).join(' ');
  // Nearby text is weaker evidence; do not let a neighbouring field's label
  // change an explicitly labelled Long Description into a short summary.
  const explicit = Object.values(purpose).some(pattern => pattern!.test(`${own} ${attributes}`));
  return [own, attributes, explicit ? '' : nearby];
}
function identify(el: Control, context: string): SmartField | undefined {
  const evidence = signals(el);
  if (blocked.test(evidence.join(' '))) return;
  if (/\bsocial\b/.test(evidence.join(' ')) && !/\b(?:facebook|linked ?in|twitter|instagram)\b/.test(evidence.join(' '))) return;
  const matches = new Set<SmartField>();
  for (const source of evidence) {
    for (const [slot, pattern] of Object.entries(purpose)) if (pattern.test(source)) matches.add(slot as SmartField);
  }
  if (matches.has('mobile')) matches.delete('phone');
  if (['facebook', 'linkedin', 'twitter', 'instagram'].some(slot => matches.has(slot as SmartField))) matches.delete('website');
  if (matches.size === 2 && matches.has('email') && matches.has('username')
    && evidence.some(value => /(?:user ?name.*e ?mail|e ?mail.*user ?name)/.test(value)))
    return el instanceof HTMLInputElement && el.type === 'password' ? undefined : el instanceof HTMLInputElement && el.type === 'email' ? 'email' : 'username';
  if (matches.size > 1) return;
  if (matches.size === 1) {
    const slot = [...matches][0];
    const typed = el instanceof HTMLInputElement ? ({ email: 'email', tel: 'phone', url: 'website', password: 'password', number: 'coordinate' } as Record<string, string>)[el.type] : undefined;
    return !typed || typed === slot || typed === 'phone' && slot === 'mobile'
      || typed === 'coordinate' && (slot === 'latitude' || slot === 'longitude')
      || typed === 'website' && ['facebook', 'linkedin', 'twitter', 'instagram'].includes(slot) ? slot : undefined;
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === 'password') return 'password';
    if (el.type === 'email') return 'email';
    if (el.type === 'tel') return 'phone';
    if (el.type === 'url') return 'website';
  }
  if (/\b(?:business|directory|listing|registration|profile)\b/.test(context)) {
    if (evidence.some(value => /^title(?: title)*$/.test(value))) return 'businessName';
    if (evidence.some(value => /^name(?: name)*$/.test(value))) return 'contactName';
  }
}
function available(el: Control, includeRadio = false): boolean {
  if (el.disabled || el.matches(':disabled') || ('readOnly' in el && el.readOnly) || !el.isConnected || isNativeDirectoryHumanControl(el)) return false;
  if (el instanceof HTMLInputElement && !['text', 'email', 'tel', 'url', 'password', 'number', ...(includeRadio ? ['radio'] : [])].includes(el.type)) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.matches('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}
function empty(el: Control): boolean {
  return el instanceof HTMLSelectElement
    ? !el.value || /^(?:select|choose|please select|none|top|root)\b/.test(normalize(el.selectedOptions[0]?.textContent || ''))
    : !el.value.trim();
}

// Reuse successful, explicitly approved account history; never treat a general
// profile password, an uncertain attempt, or a receipt alone as a site binding.
async function savedAccountApplies(profile: BusinessProfile): Promise<boolean> {
  const data = await chrome.storage.local.get(null);
  const active = data['ba2.activeProfile']?.profile;
  if (active?.id !== profile.id || active.updatedAt !== profile.updatedAt
    || (active.username || '') !== profile.username || (active.email || '') !== profile.email || (active.password || '') !== profile.password)
    throw new Error('Active profile changed during account-field preparation; nothing retried.');
  return Object.entries(data).some(([key, value]) => {
    if (key !== 'ba2.listingRun' && !key.startsWith('ba2.listingRunArchive:')) return false;
    const run = value as ListingRun | undefined;
    try {
      if (!run || run.profileId !== profile.id || !profile.updatedAt || new URL(run.sourceUrl).origin !== location.origin) return false;
      const login = run.login, registration = run.registration;
      return Boolean(run.autoLogin && login?.claimed && login.attemptId && login.state === 'authenticated'
        && run.loginApproval?.profileUpdatedAt === profile.updatedAt && new URL(login.url).origin === location.origin
        && data[loginGuardKey(run)]?.runId === run.id && data[loginGuardKey(run)]?.state === 'authenticated'
        || run.autoRegister && registration?.claimed && registration.attemptId && registration.state === 'confirmed'
        && run.registrationApproval?.profileUpdatedAt === profile.updatedAt && new URL(registration.url).origin === location.origin
        && data[`ba2.registrationGuard:${location.origin}:${profile.id}`]?.runId === run.id
        && data[`ba2.registrationGuard:${location.origin}:${profile.id}`]?.state === 'confirmed');
    } catch { return false; }
  });
}

function locationChoices(el: HTMLSelectElement, slot: SmartField, profile: BusinessProfile): HTMLOptionElement[] {
  const value = fieldValue(profile, slot as ListingField, '');
  const desired = [value, slot === 'state' ? profile.stateCode : ''];
  if (slot === 'country' && /^(?:united states(?: of america)?|usa|us)$/i.test(value)) desired.push('United States', 'USA', 'US', 'United States of America');
  return [...el.options].filter(option => !option.disabled && !option.closest('optgroup[disabled]') && option.value
    && desired.filter(Boolean).some(wanted => normalize(option.textContent || '') === normalize(wanted!) || normalize(option.value) === normalize(wanted!)));
}

function includeProfile(scope: Element): void {
  const yes = [...scope.querySelectorAll<HTMLInputElement>('input[type=radio]')].filter(radio => {
    if (!available(radio, true) || !radio.name) return false;
    const group = radio.closest('fieldset,tr,.form-group,.field') || radio.parentElement?.parentElement;
    if (!group || [...group.querySelectorAll<HTMLInputElement>('input[type=radio]')].some(other => other.name !== radio.name || other.form !== radio.form)) return false;
    const question = normalize(`${text(group)} ${radio.name} ${radio.getAttribute('aria-label') || ''}`);
    const label = normalize(`${[...(radio.labels || [])].map(text).join(' ')} ${radio.getAttribute('aria-label') || ''}`);
    return /\binclude profile with listing\b/.test(question) && /\byes\b/.test(label) && !/\bno\b/.test(label);
  });
  if (yes.length !== 1 || yes[0].checked) return;
  yes[0].checked = true;
  yes[0].dispatchEvent(new Event('input', { bubbles: true }));
  yes[0].dispatchEvent(new Event('change', { bubbles: true }));
}

/** One user-requested pass; bounded dependent-option wait, no repeated writes or human actions. */
export async function runSmartAutofill(profile: BusinessProfile): Promise<ListingAutofillReport> {
  const report: ListingAutofillReport = { smartFallback: true, profileName: profile.businessName || 'Untitled', filled: [], skipped: [], manual: [],
    adaptive: { stage: 'FORM', diagnostics: ['Smart fallback: current page only; existing values and human controls preserved'] } };
  if (isAutomationExcluded(location.href)) return { ...report, manual: ['This website is excluded from automation.'] };
  const initialUrl = location.href;
  const raw = (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile']?.profile;
  if (raw?.id !== profile.id || raw.updatedAt !== profile.updatedAt) return { ...report, manual: ['Active profile changed; nothing filled.'] };
  // Optional existing saved fields are read only here; no schema migration or fallback to phone/street.
  const optional = { address2: typeof raw.address2 === 'string' ? raw.address2 : '',
    mobile: typeof raw.mobile === 'string' && raw.mobile ? raw.mobile : typeof raw.mobilePhone === 'string' ? raw.mobilePhone : '',
    listingTitle: typeof raw.listingTitle === 'string' ? raw.listingTitle : '' };
  const coordinate = (key: 'latitude' | 'longitude') => {
    const value = raw[key];
    return (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value))
      && Math.abs(Number(value)) <= (key === 'latitude' ? 90 : 180) ? String(value) : '';
  };
  const controls = [...document.querySelectorAll<Control>('input,textarea,select')].filter(el => available(el) || el instanceof HTMLSelectElement && el.disabled);
  let accountApplies: boolean | undefined;
  for (const scope of document.querySelectorAll('form,[role="form"]')) {
    const context = normalize([scope.id, scope.getAttribute('name'), scope.getAttribute('action'), scope.getAttribute('aria-label'), scope.getAttribute('role'),
      ...[...scope.querySelectorAll('h1,h2,h3,legend,button,input[type=submit]')].map(el => el instanceof HTMLInputElement ? el.value : text(el)),
      text(scope.previousElementSibling?.matches('h1,h2,h3') ? scope.previousElementSibling : null)].join(' '));
    if (scope.querySelector('[autocomplete^="cc-"],iframe[src*="stripe"],iframe[src*="paypal"]')
      || /\b(?:search|checkout|payment|billing|subscribe|newsletter|contact us)\b/.test(context)) continue;
    const formControls = controls.filter(el => el.closest('form,[role="form"]') === scope);
    const passwordFields = formControls.filter(el => el instanceof HTMLInputElement && el.type === 'password');
    const editListing = /\b(?:edit (?:directory )?listing|edit directory|listing edit|editlisting|listingedit|directoryedit)\b/;
    const formContext = context.replace(/\binclude profile with listing\b/g, '');
    const pageContext = editListing.test(formContext) || /\b(?:profile|profileupdate|register|registration|sign ?up|create account|login|log in|sign in)\b/.test(formContext)
      ? formContext : normalize(`${location.pathname} ${formContext}`);
    const kind = editListing.test(pageContext) ? 'edit'
      : /\b(?:profile(?: ?update)?|update profile|edit profile|profile edit)\b/.test(pageContext) ? 'profile'
      : passwordFields.some(el => /\b(?:confirm|repeat|retype)\b/.test(signals(el).join(' '))) || /\b(?:register|registration|sign ?up|create account)\b/.test(pageContext) ? 'registration'
      : passwordFields.length || /\b(?:login|log in|sign in)\b/.test(pageContext) ? 'login' : 'business';
    // A normal directory form may have no heading or form name at all.
    const directoryForm = formControls.some(el => signals(el).some(value => /^title(?: title)*$/.test(value)))
      && formControls.some(el => purpose.website!.test(signals(el).join(' ')))
      && formControls.some(el => purpose.description!.test(signals(el).join(' ')));
    const fieldContext = `${directoryForm ? `${context} listing` : context} ${kind === 'edit' ? 'listing edit' : kind === 'business' ? '' : kind}`;
    const candidates = formControls.map(el => ({ el, slot: identify(el, fieldContext), evidence: signals(el).join(' ') }));
    const slots = new Set(candidates.map(item => item.slot));
    const business = candidates.some(item => item.slot === 'businessName' && purpose.businessName!.test(item.evidence))
      || /\b(?:business|directory|listing)\b/.test(fieldContext) && slots.size >= 3 && (slots.has('website') || slots.has('address'));
    if (!business && kind === 'business') continue;
    const updating = business && (kind === 'profile' || kind === 'edit');
    const accountFields = candidates.filter(item => item.slot === 'password' || item.slot === 'username' || kind === 'login' && item.slot === 'email');
    if (formControls.some(el => /\bhow did you hear\b/.test(signals(el).join(' ')))) report.manual.push('Referral: no saved answer for How did you hear about us; left manual rather than guessed.');
    if (accountFields.length) {
      accountApplies ??= await savedAccountApplies(profile);
      try {
        if (scope instanceof HTMLFormElement && new URL(scope.action || initialUrl, initialUrl).origin !== location.origin) continue;
      } catch { continue; }
    }
    const identityMismatch = candidates.some(({ el, slot }) => (slot === 'username' || slot === 'email') && el.value.trim()
      && (slot === 'email' ? el.value.trim().toLowerCase() !== profile.email.trim().toLowerCase() : el.value.trim() !== profile.username.trim())
      || slot === 'password' && el.value && el.value !== profile.password);
    if (accountFields.length && (!accountApplies || identityMismatch)) report.manual.push(identityMismatch
      ? 'Credentials: existing account values differ from the active profile; credentials left untouched.'
      : 'Credentials: no successful site-specific account association for this active profile revision; account fields left untouched.');
    const changingPassword = kind !== 'registration' && passwordFields.some(el => /\b(?:new|change|reset) password\b/.test(signals(el).join(' ')));
    const order = (slot?: SmartField) => slot === 'country' ? 0 : slot === 'state' ? 1 : slot === 'city' ? 2 : 3;
    for (const candidate of candidates.sort((a, b) => order(a.slot) - order(b.slot))) {
      let { el } = candidate;
      const { slot, evidence } = candidate;
      const descriptor = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.name ? `[name="${el.name}"]` : ''}`;
      if ((kind === 'profile' || updating) && (slot === 'state' || slot === 'city') && el instanceof HTMLSelectElement && profile[slot]) {
        // ASP.NET forms can replace disabled children after the parent's single change event.
        let waited = false;
        for (let attempt = 0; attempt <= 20 && location.href === initialUrl; attempt++) {
          if (!el.isConnected) {
            const replacements = [...scope.querySelectorAll<HTMLSelectElement>('select')].filter(next =>
              (candidate.el.id ? next.id === candidate.el.id : candidate.el.name && next.name === candidate.el.name) && identify(next, fieldContext) === slot);
            if (replacements.length === 1) el = replacements[0];
          }
          if (el instanceof HTMLSelectElement && available(el) && (locationChoices(el, slot, profile).length || !updating && !empty(el))) break;
          if (attempt === 20) break;
          waited = true;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (waited) {
          const active = (await chrome.storage.local.get('ba2.activeProfile'))['ba2.activeProfile']?.profile;
          if (active?.id !== profile.id || active.updatedAt !== profile.updatedAt) {
            report.manual.push('Active profile changed during location preparation; stopped.'); return report;
          }
        }
      }
      if (!slot || !available(el) || location.href !== initialUrl) { report.skipped.push({ descriptor, reason: 'Uncertain or unavailable business field' }); continue; }
      const credential = accountFields.some(item => item.el === el);
      if (kind === 'login' && !credential || credential && (!accountApplies || identityMismatch)) continue;
      if (slot === 'password' && (changingPassword || kind === 'edit')) continue;
      const replaceSavedName = kind === 'profile' && (slot === 'firstName' || slot === 'lastName')
        && Boolean(profile[slot].trim()) && el.value !== profile[slot];
      if (!empty(el) && !replaceSavedName && !(updating && !credential)) { report.skipped.push({ descriptor, reason: 'Existing value preserved' }); continue; }
      let value = slot === 'latitude' || slot === 'longitude' ? coordinate(slot)
        : slot === 'address2' || slot === 'mobile' ? optional[slot]
        : slot === 'description' && /\b(?:your profile|short description|summary)\b/.test(evidence) ? profile.shortDescription
        : slot === 'description' && updating ? profile.description
        : slot === 'businessName' && /\btitle\b/.test(evidence) && !/\battachment\b/.test(evidence) ? optional.listingTitle || profile.businessName
        : slot === 'contactName' ? profile.contactName || [profile.firstName, profile.lastName].filter(Boolean).join(' ')
        : fieldValue(profile, slot, evidence, slots.has('city') || slots.has('state') || slots.has('postalCode'), el);
      if (slot !== 'category' && !value.trim()) { report.skipped.push({ descriptor, reason: 'No saved value in active profile' }); continue; }
      let label: string | undefined;
      if (el instanceof HTMLSelectElement) {
        if (slot === 'category') {
          const match = family2CategoryChoice(el, profile, manualAutofillFamily(location.href) !== 2);
          if (!match.choice) { report.manual.push(`Category: ${match.reason}`); continue; }
          value = match.choice.value; label = match.choice.label;
        } else if (slot === 'country' || slot === 'state' || slot === 'city') {
          const matches = locationChoices(el, slot, profile);
          if (matches.length !== 1) { report.skipped.push({ descriptor, reason: 'No unique exact live option' }); continue; }
          value = matches[0].value; label = matches[0].textContent?.trim();
        } else continue;
      }
      if (!value) { report.skipped.push({ descriptor, reason: 'No saved value in active profile' }); continue; }
      if (el.value === value) continue;
      if (setVisibleValue(el, value, label, false)) report.filled.push({ field: slot === 'address2' ? 'address' : slot === 'mobile' ? 'phone' : slot === 'latitude' || slot === 'longitude' ? 'address' : slot, descriptor, value: slot === 'password' ? '[masked]' : label || value });
      else report.skipped.push({ descriptor, reason: 'Website did not retain value; no retry' });
    }
    if (business && kind !== 'login' && kind !== 'registration' && location.href === initialUrl && scope.isConnected) includeProfile(scope);
  }
  if (!report.filled.length) report.manual.push('No confident empty business fields found. Existing values and uncertain fields left untouched.');
  report.manual.push('Review fields; CAPTCHA, agreements and submission remain manual.');
  return report;
}
