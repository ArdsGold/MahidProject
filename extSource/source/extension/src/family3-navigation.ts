import { getFamily3Adapter } from "./automation/adapters";
import { NATIVE_DIRECTORY_FIELDS } from "./automation/native-directory";
import { jetLinksSite } from "./automation/jet-links";
import { relevantDirectoriesSite } from "./automation/relevant-directories";
import { fireDirectorySite } from "./automation/fire-directory";
import { searchDomainHereSite } from "./automation/search-domain-here";

export function isFamily3Page(value: string): boolean {
  try { const url = new URL(value); return !!getFamily3Adapter(value) && !url.username && !url.password && !url.port && !url.hash &&
    (["/", "/index.php"].includes(url.pathname) && !url.search || url.pathname === "/submit.php" && [...url.searchParams].every(([key, value]) => key === "c" && /^\d+$/.test(value))); } catch { return false; }
}
function nativeFinalAction(value: string): string {
  const id = getFamily3Adapter(value)?.config.id;
  return id === relevantDirectoriesSite.id ? relevantDirectoriesSite.submitValue : id === fireDirectorySite.id ? fireDirectorySite.submitValue : id === searchDomainHereSite.id ? searchDomainHereSite.submitValue : "Continue";
}
export function isFamily3Transition(from: string, to: string): boolean {
  if (!isFamily3Page(from) || !isFamily3Page(to)) return false;
  const source = new URL(from), target = new URL(to);
  return getFamily3Adapter(from)?.config.id === getFamily3Adapter(to)?.config.id
    && !(source.protocol === "https:" && target.protocol !== "https:");
}

export async function waitForDirectoryForm(tabId: number, expectedUrl: string): Promise<string> {
  const finalAction = nativeFinalAction(expectedUrl);
  const manualTerms = [jetLinksSite.id, "adbrite-directory", "efdir"].includes(getFamily3Adapter(expectedUrl)?.config.id || "") ? jetLinksSite.manualTerms : null;
  let lastObservation = "No document observation";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isFamily3Transition(expectedUrl, tab.url)) throw Error("Tab left the approved directory workflow");
    const [frame] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, injectImmediately: true,
      args: [NATIVE_DIRECTORY_FIELDS, manualTerms, finalAction] as [typeof NATIVE_DIRECTORY_FIELDS, typeof manualTerms, string], func: (fields, terms, finalValue) => {
        const forms = [...document.querySelectorAll("form")].filter(form => form.querySelector('[name="TITLE"]'));
        const form = forms.length === 1 ? forms[0] : null;
        const submits = form?.querySelectorAll<HTMLInputElement>('input[type="submit"][name="submit"]');
        // In a long native category list, all six fields and two options can
        // exist before parsing reaches Continue. Do not dispatch to that prefix.
        const finalControlPresent = Boolean(submits?.length === 1 && submits[0].value === finalValue && !submits[0].disabled);
        // Readiness only: the existing native adapter still validates the entire
        // structure/action/values before filling. Trailing scripts may stall DOM readiness.
        const fieldsPresent = Boolean(form && fields.every(spec => {
          const controls = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${spec.name}"]`);
          return controls.length === 1 && controls[0].tagName === spec.tag && !controls[0].disabled
            && (spec.tag !== "SELECT" || (controls[0] as HTMLSelectElement).options.length > 1);
        }));
        // F07 has a manual Exit after Continue. Wait for those controls to be
        // parsed, never for the human checkbox to become accepted/checked.
        const manualControlsPresent = !terms || Boolean(form &&
          [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some(el => el.name === terms.name && el.value === terms.value) &&
          [...form.querySelectorAll<HTMLInputElement>('input[type="button"]')].some(el => !el.name && el.value === terms.exitValue));
        const formPresent = fieldsPresent && finalControlPresent && manualControlsPresent;
        // A fully parsed changed form can reach the conservative field fallback.
        // This is read-only readiness, never permission to click a form action.
        const fallbackFormPresent = document.readyState === 'complete' && [...document.querySelectorAll('form')].some(candidate =>
          candidate.querySelectorAll('input,textarea,select').length >= 3 && [...candidate.querySelectorAll<HTMLInputElement>('input')].some(input =>
            input.type === 'text' && /\b(?:business\s*name|company\s*name|organization)\b/i.test([
              input.name.replace(/_/g, ' '), input.id.replace(/_/g, ' '), input.placeholder, input.getAttribute('aria-label'),
              ...[...(input.labels || [])].map(label => label.textContent),
            ].join(' '))));
        return { url: location.href, ready: document.readyState !== "loading", readyState: document.readyState, fieldsPresent, formPresent, finalControlPresent, fallbackFormPresent };
      } });
    const observed = frame?.result;
    lastObservation = `tab=${tab.url}; document=${observed?.url}; readyState=${observed?.readyState}; nativeFieldsPresent=${observed?.fieldsPresent}; finalControlPresent=${observed?.finalControlPresent}`;
    const expected = new URL(expectedUrl), actual = new URL(tab.url);
    if (actual.pathname === expected.pathname && actual.search === expected.search && observed?.url === tab.url && (observed.formPresent || observed.fallbackFormPresent)) return tab.url;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for listing page. ${lastObservation}`);
}

