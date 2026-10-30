import { manualAutofillFamily } from "../manual-autofill-policy";
// Standalone publication reader: no autofill, login, profile sync or submission.
import { observeBlogWorkflow } from "../automation/blog-workflow";
import { articleExpectation, verifyPublicArticleHtml } from "../automation/verification";
import type { ExtensionMessage } from "../messages";
import { readListingRun } from "../listing-run";
import { TRACE_READ_ONLY } from '../publication-trace';

const scope = globalThis as typeof globalThis & { __ba2PublicationReader?: unknown };
if (window.top === window && location.protocol === "https:" && scope.__ba2PublicationReader !== chrome.runtime.onMessage) {
  scope.__ba2PublicationReader = chrome.runtime.onMessage;
  let observer: MutationObserver | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  let watchedAttempt: string | undefined;
  let notified = false;
  const stopWatching = () => { observer?.disconnect(); observer = undefined; clearTimeout(watchTimer); };
  const watchPublication = async (runId?: string, attemptId?: string) => {
    if (TRACE_READ_ONLY || manualAutofillFamily(location.href)) return;
    const run = await readListingRun();
    if (!run || !run.submissionAttempted || !run.publicationSubmission || !run.autoPublish || !run.publicationApproval
      || !run.expectedArticle || run.publicVerification?.status === 'verified' || run.publicVerification?.status === 'failed'
      || new URL(run.sourceUrl).origin !== location.origin || runId && run.id !== runId || attemptId && run.publicationSubmission.attemptId !== attemptId) return;
    if (watchedAttempt === run.publicationSubmission.attemptId && (observer || notified)) return;
    stopWatching();
    watchedAttempt = run.publicationSubmission.attemptId;
    notified = false;
    const check = () => {
      if (notified) return;
      const page = observeBlogWorkflow(document, location.href);
      if (page.stage !== 'CONFIRMATION' || !page.publicationEvidence || !page.publicUrl) return;
      notified = true;
      stopWatching();
      // Metadata only. The coordinator rereads the page and authenticates tab,
      // frame, run, persisted intent and receipt before any verification.
      void chrome.runtime.sendMessage({ type: 'BA2_PUBLICATION_CHANGED', runId: run.id,
        attemptId: run.publicationSubmission!.attemptId } satisfies ExtensionMessage).catch(() => undefined);
    };
    observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
    watchTimer = setTimeout(stopWatching, 60_000);
    check();
  };
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "BA2_BLOG_OBSERVE") sendResponse(observeBlogWorkflow(document, location.href));
    else if (message.type === "BA2_WATCH_PUBLICATION") {
      void watchPublication(message.runId, message.attemptId).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    }
    else if (message.type === "BA2_VERIFY_PUBLIC_ARTICLE") sendResponse(verifyPublicArticleHtml(message.html, message.expected, document, message.responseUrl));
    else if (message.type === "BA2_BUILD_ARTICLE_EXPECTATION") sendResponse(articleExpectation(message.title, message.html, document));
    else return;
    return true;
  });
  // A new document (including /new POST success) rearms observation from the
  // saved intent. A service-worker restart never grants publication permission.
  void watchPublication().catch(() => undefined);
}
