import { manualAutofillFamily, currentPageAutofillOnly, smartAutofillOnly } from "../manual-autofill-policy";
import { getFamily3Adapter } from "../automation/adapters";
import { isAutomationExcluded } from "@backlink-autofill/shared";
import { LISTING_RUN_KEY, type ListingRun } from "../listing-run";

export const FLOATING_BUTTON_ID = "ba2-floating-autofill";
export const FLOATING_BUTTON_POSITION_KEY = "ba2.floatingButtonPosition";

export interface FloatingButtonPosition {
  left: number;
  top: number;
}

const EDGE_GAP = 16;
const DRAG_THRESHOLD = 6;

export function clampFloatingButtonPosition(
  position: FloatingButtonPosition,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  buttonWidth = 108,
  buttonHeight = 42,
): FloatingButtonPosition {
  return {
    left: Math.min(Math.max(position.left, EDGE_GAP), Math.max(EDGE_GAP, viewportWidth - buttonWidth - EDGE_GAP)),
    top: Math.min(Math.max(position.top, EDGE_GAP), Math.max(EDGE_GAP, viewportHeight - buttonHeight - EDGE_GAP)),
  };
}

function isExcludedPage(): boolean {
  if (isAutomationExcluded(location.href)) return true;
  if (window.top !== window) return true;
  if (!/^https?:$|^file:$/.test(location.protocol)) return true;
  try {
    const url = new URL(location.href);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "3000";
  } catch {
    return true;
  }
}

function defaultPosition(): FloatingButtonPosition {
  return clampFloatingButtonPosition({ left: window.innerWidth - 124, top: window.innerHeight - 58 });
}

function applyPosition(host: HTMLElement, position: FloatingButtonPosition): FloatingButtonPosition {
  const next = clampFloatingButtonPosition(position, window.innerWidth, window.innerHeight, host.offsetWidth || 108, host.offsetHeight || 42);
  host.style.left = `${next.left}px`;
  host.style.top = `${next.top}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
  return next;
}

function readSavedPosition(): Promise<FloatingButtonPosition | undefined> {
  return chrome.storage.local.get(FLOATING_BUTTON_POSITION_KEY).then((data) => {
    const value = data[FLOATING_BUTTON_POSITION_KEY] as Partial<FloatingButtonPosition> | undefined;
    return typeof value?.left === "number" && typeof value.top === "number" ? value as FloatingButtonPosition : undefined;
  }).catch(() => undefined);
}

function savePosition(position: FloatingButtonPosition): void {
  void chrome.storage.local.set({ [FLOATING_BUTTON_POSITION_KEY]: position }).catch(() => undefined);
}

export function installFloatingAutofillButton(): HTMLElement | null {
  if (isExcludedPage()) return null;
  const family3 = Boolean(getFamily3Adapter(location.href));
  let contextInvalidated = false;
  const existing = document.getElementById(FLOATING_BUTTON_ID);
  if (existing) return existing;

  const host = document.createElement("div");
  host.id = FLOATING_BUTTON_ID;
  host.setAttribute("aria-label", "Backlink Autofill");
   host.style.cssText = "position:fixed;left:0;top:0;width:160px;height:64px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { contain: layout style; }
     button { all: unset; box-sizing: border-box; display: grid; place-items: center; width: 160px; height: 42px; padding: 0 16px; border-radius: 999px; background: #6d28d9; color: #fff; font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .08em; cursor: grab; user-select: none; touch-action: none; box-shadow: 0 8px 24px rgba(55, 24, 110, .25); transition: background-color .16s ease, transform .16s ease, box-shadow .16s ease; }
    button:hover { background: #5b21b6; transform: translateY(-1px); box-shadow: 0 10px 28px rgba(55, 24, 110, .32); }
    button:active, button.dragging { cursor: grabbing; transform: scale(.97); }
    button:focus-visible { outline: 3px solid #c4b5fd; outline-offset: 3px; }
    @media (prefers-reduced-motion: reduce) { button { transition: none; } }
     .status { min-height: 18px; max-width: 160px; padding: 3px 8px 0; color: #4c1d95; font: 600 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
     .status.error { color: #b91c1c; }
   </style><button type="button" aria-label="Autofill current page">AUTOFILL</button><div class="status" role="status" aria-live="polite"></div>`;
   const button = shadow.querySelector("button") as HTMLButtonElement;
   if (family3 || smartAutofillOnly(location.href)) {
     // MAHID's gesture must not become a page-level CAPTCHA activation gesture.
     for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup', 'focusin', 'focusout']) {
       button.addEventListener(type, event => event.stopPropagation());
     }
     button.addEventListener('pointerdown', event => event.preventDefault());
   }
   button.title = currentPageAutofillOnly(location.href) ? 'Fill the current form only. Navigate and submit manually.' : 'AUTOFILL authorizes supported registration, Login and one approved article publication for this run. CAPTCHA and required human consent stay manual.';
   if (family3) button.title = 'Fill directory fields only. CAPTCHA and final Continue/Submit remain human-controlled.';
   const status = shadow.querySelector(".status") as HTMLDivElement;
  document.documentElement.append(host);
  let position = applyPosition(host, defaultPosition());
  let pointerId: number | undefined;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let dragged = false;
  let suppressClick = false;

  void readSavedPosition().then((saved) => {
    if (saved && document.getElementById(FLOATING_BUTTON_ID) === host) position = applyPosition(host, saved);
  });

  button.addEventListener("pointerdown", (event) => {
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = position.left;
    startTop = position.top;
    dragged = false;
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!dragged && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;
    dragged = true;
    event.preventDefault();
    button.classList.add("dragging");
    position = applyPosition(host, { left: startLeft + deltaX, top: startTop + deltaY });
  });
  button.addEventListener("pointerup", (event) => {
    if (pointerId !== event.pointerId) return;
    if (dragged) {
      suppressClick = true;
      savePosition(position);
    }
    pointerId = undefined;
    button.classList.remove("dragging");
    button.releasePointerCapture?.(event.pointerId);
  });
  button.addEventListener("pointercancel", () => {
    pointerId = undefined;
    button.classList.remove("dragging");
  });
   const setStatus = (message: string, error = false): void => {
     status.textContent = message;
     if (manualAutofillFamily(location.href) === 2 || family3) status.title = message;
     status.classList.toggle("error", error);
   };
   const renderRunStatus = (run: ListingRun | null): void => {
     if (contextInvalidated) return;
     button.textContent = 'AUTOFILL';
     if (currentPageAutofillOnly(location.href)) { setStatus('Fill the current form only. Navigate and submit manually.'); return; }
     if (!run) return;
     if (run.publicVerification) { setStatus(`Public article: ${run.publicVerification.status}`); return; }
     if (run.submissionAttempted) { setStatus('Checking existing publication; resubmission blocked'); return; }
     const checkpoint = run.login?.state === 'waiting-captcha' ? run.login.url
       : run.registration?.state === 'waiting-human' ? run.registration.url : undefined;
     if (checkpoint && checkpoint !== location.href) {
       setStatus('Saved checkpoint is on another page. AUTOFILL uses the current page.'); return;
     }
     if (run.login?.state === 'uncertain' || run.registration?.state === 'uncertain') {
       setStatus('Account outcome unresolved; no automatic replay', true); return;
     }
     if (run.login?.state === 'waiting-captcha' || run.registration?.state === 'waiting-human') {
       setStatus('Complete the human checkpoint; authorized workflow continues automatically'); return;
     }
     if (run.error) { setStatus(run.error, true); return; }
     setStatus(run.manual[0] || (run.stage === 'COMPLETE' ? 'Workflow complete' : 'Continuing authorized workflow'));
   };
   const refreshRunStatus = async (): Promise<void> => {
     try {
       const data = await chrome.storage.local.get(LISTING_RUN_KEY);
       renderRunStatus((data[LISTING_RUN_KEY] as ListingRun | undefined) || null);
     } catch {
       // The command response remains the authoritative startup diagnostic.
     }
   };
   if (chrome.storage.onChanged?.addListener) {
     chrome.storage.onChanged.addListener((changes, areaName) => {
       if (areaName === "local" && changes[LISTING_RUN_KEY]) void refreshRunStatus();
     });
   }
   void refreshRunStatus();

   button.addEventListener("click", async (event) => {
     if (!event.isTrusted) return; // Page scripts cannot authorize account/publication actions.
     if (contextInvalidated) return;
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
     button.disabled = true;
     setStatus("Starting AUTOFILL...");
     try {
       if (family3 && !chrome.runtime.id) throw Error('Extension context invalidated');
       const response = await chrome.runtime.sendMessage({ type: "BA2_START_LISTING_AUTOFILL", continuous: true }) as { ok?: boolean; error?: string; message?: string; requiresAuthorization?: boolean };
       if (family3 && /extension context invalidated/i.test(response?.error || '')) throw Error('Extension context invalidated');
       if (!response?.ok) {
         button.textContent = "RETRY AUTOFILL";
         setStatus(response?.error || "Autofill could not start.", true);
       } else {
         setStatus(response.message || (response.requiresAuthorization ? "Complete CAPTCHA, then continue" : "AUTOFILL started"));
         if (!response.message) await refreshRunStatus();
       }
     } catch (error) {
       if (family3 && /extension context invalidated/i.test(error instanceof Error ? error.message : String(error))) {
         contextInvalidated = true;
         button.textContent = 'AUTOFILL';
         setStatus('Extension reloaded. Refresh this page before AUTOFILL. Nothing retried; CAPTCHA and Submit remain manual.', true);
       } else {
         button.textContent = "RETRY AUTOFILL";
         setStatus(error instanceof Error ? error.message : "Autofill could not start.", true);
       }
     } finally {
       button.disabled = contextInvalidated;
     }
  });
  window.addEventListener("resize", () => {
    position = applyPosition(host, position);
    savePosition(position);
  });
  return host;
}
