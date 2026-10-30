import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const script = await readFile(new URL('../dist/content/publication-reader.js', import.meta.url), 'utf8');
// A repaired observation-only listener is not a full autofill receiver.
const homepageWindow = new Window({ url: 'https://bloguetechno.com/' });
homepageWindow.document.write('<a href="/signup">Sign Up</a> <a href="/login">Login</a>');
const homepageBefore = homepageWindow.document.body.innerHTML;
const homepageListeners = [];
homepageWindow.chrome = {
  runtime: { id: 'a'.repeat(32), onMessage: { addListener: listener => homepageListeners.push(listener) },
    sendMessage: () => assert.fail('Read-only homepage reader must not resume automation') },
  storage: { local: { get: async key => ({ [key]: { stage: 'ERROR', autoLogin: true, autoPublish: false, sourceUrl: 'https://bloguetechno.com/' } }),
    set: () => assert.fail('Reader cannot write run or receipts') } },
};
homepageWindow.eval(script);
const homepageSender = { id: 'a'.repeat(32) };
let homepageObservation;
homepageListeners[0]({ type: 'BA2_BLOG_OBSERVE' }, homepageSender, value => { homepageObservation = value; });
assert.equal(homepageObservation.stage, 'HOMEPAGE');
for (const type of ['BA2_LISTING_AUTOFILL', 'BA2_GET_ACTIVE_PROFILE', 'BA2_LOGIN_PREPARE', 'BA2_LOGIN_SUBMIT_ONCE']) {
  let response;
  assert.equal(homepageListeners[0]({ type }, homepageSender, value => { response = value; }), undefined);
  assert.equal(response, undefined, 'observation receiver does not acknowledge ' + type);
}
await homepageWindow.happyDOM.whenAsyncComplete();
assert.equal(homepageWindow.document.body.innerHTML, homepageBefore);
await homepageWindow.happyDOM.close();
console.log('Bloguetechno observation-only homepage reader recognizes page but has no autofill/profile/Login handler; no DOM or saved-state changes');
const window = new Window({ url: 'https://onesmablog.com/new' });
window.document.write('<div>The Article was successfully published. <a href="/fixture-article-12345">Visit</a> / <a href="/edit/12345">Edit</a></div>');
const before = window.document.body.innerHTML;
const listeners = [];
const id = 'a'.repeat(32);
let savedRun = null;
const notifications = [];
window.chrome = {
  runtime: { id, onMessage: { addListener: listener => listeners.push(listener) }, sendMessage: async message => { notifications.push(message); return { ok: true }; } },
  storage: { local: { get: async key => { assert.equal(key, 'ba2.listingRun'); return { [key]: savedRun }; }, set: () => assert.fail('reader must not write storage') } },
};
window.eval(script);
window.eval(script);
assert.equal(listeners.length, 1, 'reinjecting observation does not add duplicate receivers');
let response;
const send = (message, sender = { id }) => {
  response = undefined;
  const result = listeners[0](message, sender, value => { response = value; });
  return { result, response };
};
const observed = send({ type: 'BA2_BLOG_OBSERVE' }).response;
assert.equal(observed.stage, 'CONFIRMATION');
assert.equal(observed.publicUrl, 'https://onesmablog.com/fixture-article-12345');
assert.equal(send({ type: 'BA2_BLOG_OBSERVE' }, { id: 'b'.repeat(32) }).response, undefined);
for (const type of ['BA2_BLOG_PUBLISH_ONCE', 'BA2_LISTING_AUTOFILL', 'BA2_LOGIN_PREPARE', 'BA2_SYNC_VERIFIED_LISTING'])
  assert.equal(send({ type }).response, undefined, 'reader must not implement action messages');
const text = 'This approved article has a complete long body containing useful details for independent public content verification and reliable evidence.';
const expected = send({ type: 'BA2_BUILD_ARTICLE_EXPECTATION', title: 'Approved title', html: `<p>${text}</p>` }).response;
assert.equal(send({ type: 'BA2_VERIFY_PUBLIC_ARTICLE', expected, html: `<article><h1>Approved title</h1><p>${text}</p></article>`, responseUrl: observed.publicUrl }).response.status, 'verified');
assert.equal(window.document.body.innerHTML, before, 'all reading leaves the live success page untouched');
await Promise.resolve();
assert.equal(notifications.length, 0, 'no saved attempt means no automatic continuation');
window.document.body.innerHTML = '<div>Waiting for publication response</div>';
savedRun = { id: 'saved-run', sourceUrl: 'https://onesmablog.com/new', submissionAttempted: true, autoPublish: true,
  publicationApproval: {}, publicationSubmission: { attemptId: 'saved-attempt' }, expectedArticle: expected };
await new Promise(resolve => listeners[0]({ type: 'BA2_WATCH_PUBLICATION', runId: savedRun.id, attemptId: 'saved-attempt' }, { id }, resolve));
assert.equal(notifications.length, 0);
window.document.body.innerHTML = '<div>The Article was successfully published. <a href="/fixture-article-12345">Visit</a> / <a href="/edit/12345">Edit</a></div>';
await window.happyDOM.whenAsyncComplete();
assert.deepEqual(notifications, [], 'manual Family 1 reader must not wake historical automation');
window.document.body.append(' Another page mutation.');
await window.happyDOM.whenAsyncComplete();
assert.equal(notifications.length, 0, 'one notification per attempt, not per mutation');
await window.happyDOM.close();
const restoredWindow = new Window({ url: 'https://onesmablog.com/new' });
restoredWindow.document.write(before);
restoredWindow.chrome = window.chrome;
restoredWindow.eval(script);
await restoredWindow.happyDOM.whenAsyncComplete();
assert.equal(notifications.length, 0, 'a loaded POST success document notifies from the saved intent without a popup click');
await restoredWindow.happyDOM.close();
console.log('Publication reader passed: idempotent receiver, Visit not Edit, detached parsing, bounded success observation without manual-family continuation and no storage writes/actions');
// Synthetic current Visit differs from the historically observed article ID.
for (const domain of ['bloguetechno.com', 'thezenweb.com']) {
const bloguetechnoUrl = `https://fixture.${domain}/already-published-80348278`;
const bloguetechno = new Window({ url: `https://${domain}/new` });
bloguetechno.document.write('<form method="post"><input name="title"><textarea id="content"></textarea><a href="" id="successfully_posted" style="display:none"></a><a href="/edit/80348278">Edit</a></form>');
savedRun = { ...savedRun, id: `existing-${domain}-publication`, sourceUrl: `https://${domain}/new`,
  publicationSubmission: { attemptId: 'already-submitted' } };
const blogListeners = [], blogNotifications = [];
bloguetechno.chrome = { ...window.chrome, runtime: { ...window.chrome.runtime,
  onMessage: { addListener: listener => blogListeners.push(listener) },
  sendMessage: async message => { blogNotifications.push(message); return { ok: true }; } } };
bloguetechno.eval(script);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(blogNotifications.length, 0, 'empty hidden editor placeholder must not trigger Visit');
const successLink = bloguetechno.document.querySelector('a#successfully_posted');
successLink.href = bloguetechnoUrl;
successLink.textContent = 'Visit';
successLink.style.display = '';
await bloguetechno.happyDOM.whenAsyncComplete();
let blogObservation;
blogListeners[0]({ type: 'BA2_BLOG_OBSERVE' }, { id }, response => { blogObservation = response; });
assert.equal(blogObservation.stage, 'CONFIRMATION', domain + ' success marker must be recognized with retained editor DOM');
assert.equal(blogObservation.publicUrl, bloguetechnoUrl);
assert.equal(blogObservation.publicationEvidence, true);
assert.deepEqual(blogNotifications, [], 'manual publication success is observation only; no Visit');
await bloguetechno.happyDOM.close();
console.log(`${domain} saved success page passed: exact Visit ID/public subdomain, no automatic existing-intent notification, zero actions or storage writes`);
}
