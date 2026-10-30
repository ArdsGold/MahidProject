"""Publish mapped free directory/classified listings through the user's Ui.Vision Chrome."""
import argparse
import json
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace

from playwright.sync_api import sync_playwright

from backlinks import (CLASSIFIEDS, DIRECTORIES, US_STATES, NeedsAttention, campaign_folder,
                       campaign_lock, check_public_url, content, domain, load_workbook, save, stamp, verify, publish, recover_directory)
from uivision import BridgeError, UiVision, tool_text, bridge_connected
from mappings.directories import DIRECTORY_SITES, DIRECTORY_INSPECTOR, submission_url
from mappings.classified_routes import category_route, location as classified_location
from mappings.categories import CATEGORY_MATCHER
from mappings.category_records import saved_rule, observe as observe_categories, capture_options
from mappings.common import CONTENT_FITTER, content_parts, publication_domain, InspectionRequired
from mappings.registry import SUPPORTED
from template_detector import FORM_STRUCTURE_JS, observe_browser
from operator_notifications import operator_input, check_cancelled
from website_pool import (DEFAULT_POOL, DEFAULT_TARGET, merge_pool, ranked_entries,
                          begin_attempt, seed_history, configure_target, target_for,
                          verified_count, progress_message, refresh_pool)


SCRIPT = Path(__file__).resolve().parent / 'mappings' / 'uivision.js'
SAFE_TO_START = {'not_run', 'needs_attention', 'needs_mapping', 'failed'}


def prompt(message):
    try:
        return operator_input(message).strip().lower()
    except EOFError:
        raise NeedsAttention('Verification needs a terminal: run Start_Browser_Automation.ps1 to continue.') from None


def make_job(business, host):
    job = {key: business.get(key, '') for key in ('name', 'website', 'description', 'category', 'category_fallbacks', 'email', 'services', 'short_description')}
    job.update(domain=host, workflow='classifieds' if host in CLASSIFIEDS else 'directory',
               markdown=content(business)[1], content_parts=content_parts(business, host in CLASSIFIEDS))
    job['category_rule'] = saved_rule(host, business)
    if host in DIRECTORY_SITES:
        job['directory'] = DIRECTORY_SITES[host]
        job['submission_url'] = submission_url(job['directory'])
    if host in CLASSIFIEDS:
        place = classified_location(business)
        if place:
            job['city'], job['state_name'] = place
        job['classified_route'] = category_route(business)
    return job


def run_stage(client, job, stage):
    check_cancelled()
    source = 'const importedDirectoryInspector = ' + json.dumps(DIRECTORY_INSPECTOR) + ';\n'
    source += 'const templateCollector = ' + json.dumps(FORM_STRUCTURE_JS) + ';\n'
    source += 'const categoryMatcher = ' + json.dumps(CATEGORY_MATCHER) + ';\n'
    source += 'const contentFitter = ' + json.dumps(CONTENT_FITTER) + ';\n'
    source += 'const job = ' + json.dumps(job, ensure_ascii=False) + ';\nconst stage = ' + json.dumps(stage) + ';\n'
    result = client.call('run_macro', {'script': source + SCRIPT.read_text(encoding='utf-8'),
                                      'look': 'none', 'log_limit': 40000 if stage == 'prepare' else 4000}, timeout=180)
    matches = re.findall(r'BACKLINK_RESULT:(\{[^\n]*\})', tool_text(result))
    if not matches:
        raise BridgeError('Browser workflow did not return a result; inspect the page before repeating.')
    result = json.loads(matches[-1])
    navigation = result.pop('category_navigation', None)
    if navigation:
        from mappings.category_records import observe_route
        path = observe_route(job['domain'], job, navigation, job.get('classified_route'))
        result['category_options_path'] = path.relative_to(Path(__file__).resolve().parent).as_posix()
        if job.get('classified_route') and all(step.get('selected') for step in navigation):
            result['selected_category'] = {'label': ' > '.join(job['classified_route']['labels']),
                                           'value': navigation[-1]['selected']['value'],
                                           'reason': job['classified_route']['reason']}
    category = result.pop('category_evidence', None)
    if category:
        rule = job.get('category_rule') or {}
        selected = category.get('selected')
        options = category.get('options')
        if options is None:
            options = capture_options(client, category['selector'], category['option_count'])
        reused = bool(selected and rule.get('selected') and str(selected.get('value')) == str(rule['selected'].get('value')))
        reason = rule.get('reason') if reused else 'Matched approved primary/fallback category or clear business-topic evidence' if selected else 'No unambiguous deterministic match; assistant review required'
        path = observe_categories(job['domain'], job, options, category.get('page', ''),
                                  selected=selected, reason=reason, source=rule.get('source', 'saved') if reused else 'automatic' if selected else 'needs_review')
        result['category_options_path'] = path.relative_to(Path(__file__).resolve().parent).as_posix()
        if selected:
            result['selected_category'] = {'label': selected.get('label', selected.get('text', '')), 'value': str(selected['value']), 'reason': reason}
    structure = result.pop('template_structure', None)
    if structure:
        try:
            observe_browser(job['domain'], structure)
        except OSError:
            print('Template evidence could not be saved; publishing safeguards remain active.', flush=True)
    return result


def inspect_uncertain(client, browser, business, host, state, folder, entries):
    """Read receipts/recover URLs once; unresolved work pauses the queue without reposting."""
    previous = state.get(host, {})
    if previous.get('review_disposition') == 'operator_deferred':
        return
    if previous.get('status') not in ('submitting', 'uncertain', 'unverified'):
        return
    try:
        receipt = run_stage(client, make_job(business, host), 'receipt')
        if receipt.get('status') == 'candidate':
            public_host = publication_domain(host, previous)
            check_public_url(receipt['url'], public_host)
            previous.update(candidate_url=receipt['url'], status='unverified')
            save(state, folder, entries)
        elif receipt.get('status') in ('pending', 'rejected'):
            previous.update(status=receipt['status'], reason=receipt.get('reason', 'Read-only receipt inspection'))
        if previous.get('candidate_url'):
            state[host] = {**previous, **verify(browser, previous['candidate_url'], business,
                                               publication_domain(host, previous))}
        elif host in DIRECTORIES:
            recover_directory(browser, business, host, state, folder, entries,
                              'existing' if previous.get('status') == 'rejected' else 'new')
    except Exception:
        # Inspection failure cannot authorize or trigger another final click.
        pass
    state[host]['inspection_action'] = 'Read-only receipt and exact public backlink recovery'
    if state[host].get('status') in ('published', 'pending', 'rejected'):
        state[host]['validated_inspection_rule'] = 'Receipt/public result resolved without reposting'
    save(state, folder, entries)
    if state[host].get('status') in ('submitting', 'uncertain', 'unverified'):
        raise InspectionRequired(host, 'Read-only inspection could not resolve this result. Queue paused; no repost permitted.')


def run_queue(client, browser, business, entries, state, folder, only=None, all_sites=False):
    hosts = list(dict.fromkeys(entry['domain'] for entry in entries))
    hosts = [e['domain'] for e in ranked_entries([{'domain': host} for host in hosts], folder)]
    for host in hosts:
        check_cancelled()
        if not all_sites and verified_count(state) >= target_for(folder):
            break
        if host not in SUPPORTED or (only and host not in only):
            if host not in SUPPORTED and (not state.get(host) or state[host].get('status') == 'needs_mapping') and (not only or host in only):
                state[host] = {'status': 'needs_mapping', 'score_deferred': True,
                               'reason': 'No reusable publishing workflow yet; needs mapping', 'checked_utc': stamp()}
                save(state, folder, entries)
            continue
        previous = state.get(host, {})
        if previous.get('review_disposition') == 'operator_deferred':
            continue
        if previous.get('status') != 'published' and previous.get('candidate_url'):
            # Receipt-bound recovery: inspect the saved result, never repeat a submit.
            try:
                public_host = publication_domain(host, previous)
                verified = verify(browser, previous['candidate_url'], business, public_host)
                check_public_url(verified['url'], public_host)
                state[host] = {**previous, **verified}
            except Exception:
                previous.update(reason='Saved public candidate could not be verified; no submission repeated', checked_utc=stamp())
            save(state, folder, entries)
            print(host, 'saved candidate checked:', state[host].get('status', 'unverified'), flush=True)
            inspect_uncertain(client, browser, business, host, state, folder, entries)
            continue
        if previous.get('status', 'not_run') not in SAFE_TO_START or previous.get('candidate_url'):
            if host in DIRECTORIES and previous.get('status') in ('pending', 'rejected', 'uncertain'):
                if recover_directory(browser, business, host, state, folder, entries,
                                     'existing' if previous.get('status') == 'rejected' else 'new'):
                    print(host, 'published: recovered public detail page', flush=True)
                    continue
            print(host, 'skipped:', previous.get('status', 'existing candidate'), flush=True)
            inspect_uncertain(client, browser, business, host, state, folder, entries)
            continue
        if host not in DIRECTORIES | CLASSIFIEDS:
            # Existing individual-platform adapters use Playwright (or the official API).
            # CAPTCHA there remains a deferred task; Chrome continues with the next site.
            desktop = os.environ.get('BACKLINK_DESKTOP') == '1'
            interactive_browser = desktop and host != 'telegra.ph'
            platform_browser = browser.browser_type.launch(headless=False) if interactive_browser else browser
            try:
                publish(platform_browser, business, entries, state, folder,
                        SimpleNamespace(only=[host], interactive=interactive_browser, manual_review=False, all_sites=all_sites))
            finally:
                if interactive_browser:
                    platform_browser.close()
            inspect_uncertain(client, browser, business, host, state, folder, entries)
            continue
        job = make_job(business, host)
        print('\nOpening', host, flush=True)
        started = False
        operator_skipped = False
        metadata = {}
        begin_attempt(folder, host)
        state[host] = {'status': 'needs_attention', 'score_deferred': True,
                       'reason': 'Form preparation started; no submission yet', 'checked_utc': stamp()}
        save(state, folder, entries)
        try:
            result = run_stage(client, job, 'prepare')
            while result.get('status') == 'access_challenge':
                answer = prompt(host + ': Complete browser verification, then Enter to retry filling. Type skip or stop: ')
                if answer == 'stop':
                    raise KeyboardInterrupt
                if answer == 'skip':
                    operator_skipped = True
                    break
                result = run_stage(client, job, 'prepare')
            metadata = {key: result[key] for key in ('omitted_fields', 'content_notes', 'category_options_path', 'selected_category') if key in result}
            job.update(metadata)
            if 'content_limit' in result:
                job['content_limit'] = result['content_limit']
            if result.get('status') != 'ready':
                reason = result.get('reason', 'Browser access challenge')
                needs_mapping = any(word in reason.lower() for word in ('mapping', 'changed', 'control missing', 'unexpected form'))
                state[host] = {'status': 'skipped' if operator_skipped else 'needs_mapping' if needs_mapping else 'needs_attention', 'score_deferred': operator_skipped or needs_mapping or result.get('status') == 'access_challenge', 'reason': 'Skipped by operator before submission' if operator_skipped else reason, 'checked_utc': stamp()}
                save(state, folder, entries)
                if result.get('status') == 'category_review':
                    print(host, 'category inventory saved; queue waiting for assistant mapping review', flush=True)
                    break
                continue
            while result.get('challenge'):
                answer = prompt(host + ': Complete CAPTCHA in Chrome, then Enter to submit. Type skip or stop: ')
                if answer == 'stop':
                    raise KeyboardInterrupt
                if answer == 'skip':
                    operator_skipped = True
                    break
                result = run_stage(client, job, 'check')
            if result.get('challenge'):
                state[host] = {'status': 'skipped' if operator_skipped else 'needs_attention', 'score_deferred': True, 'reason': 'Skipped by operator before submission' if operator_skipped else 'CAPTCHA not completed', 'checked_utc': stamp()}
                save(state, folder, entries)
                continue
            # Persist BEFORE the final click, including on interruption or a lost bridge connection.
            check_cancelled()
            state[host] = {**metadata, 'status': 'submitting', 'reason': 'Ui.Vision final submission started', 'checked_utc': stamp()}
            save(state, folder, entries)
            started = True
            check_cancelled()
            result = run_stage(client, job, 'submit')
            if result['status'] == 'candidate':
                url = result['url']
                state[host] = {**metadata, 'status': 'unverified', 'candidate_url': url, 'reason': 'Public URL awaiting verification', 'checked_utc': stamp()}
                save(state, folder, entries)
                try:
                    verified = verify(browser, url, business, host)
                    check_public_url(verified['url'], host)
                    state[host] = {**state[host], **verified}
                except Exception:
                    state[host]['reason'] = 'Public URL saved, but independent verification failed; do not submit again'
            else:
                state[host] = {'status': result['status'], 'reason': result.get('reason', 'Review required'), 'checked_utc': stamp()}
                state[host].update(metadata)
                if host in DIRECTORIES and result['status'] in ('pending', 'rejected', 'uncertain'):
                    recover_directory(browser, business, host, state, folder, entries,
                                      'existing' if result['status'] == 'rejected' else 'new')
        except (BridgeError, NeedsAttention) as exc:
            private = Path(__file__).resolve().parent / '.local' / folder.name
            private.mkdir(parents=True, exist_ok=True)
            (private / 'uivision-last-error.txt').write_text(str(exc), encoding='utf-8')
            changed = not started and any(term in str(exc).lower() for term in ('mapping', 'form changed', 'changed form', 'no unique', 'unexpected listing domain', 'no automatic workflow'))
            state[host] = {'status': 'uncertain' if started else 'needs_mapping' if changed else 'needs_attention',
                           'score_deferred': changed or (not started and isinstance(exc, NeedsAttention)),
                           'reason': 'Ui.Vision connection or form failed after submit; inspect site before retrying' if started else 'Ui.Vision form needs attention; see browser log',
                           'checked_utc': stamp()}
            if changed:
                state[host]['reason'] = 'Saved workflow no longer matches this page; mapping repair required'
            print(str(exc).splitlines()[0].encode('ascii', errors='backslashreplace').decode('ascii'), flush=True)
            if 'stopped by the user' in str(exc).lower() or 'stopped by user' in str(exc).lower():
                if not started:
                    state[host]['score_deferred'] = True
                raise KeyboardInterrupt from None
        except Exception as exc:
            # Continue the pool on changed/invalid receipts without exposing page data.
            state.setdefault(host, {}).update(status='uncertain' if started else 'failed',
                                              score_deferred=False,
                                              reason=type(exc).__name__ + ': browser workflow or result verification failed; inspect before retrying',
                                              checked_utc=stamp())
        finally:
            state.setdefault(host, {}).update(metadata)
            save(state, folder, entries)
        print(host, state[host]['status'], flush=True)
        inspect_uncertain(client, browser, business, host, state, folder, entries)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--sheet')
    parser.add_argument('--campaign', default='default')
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--workbook-sites-only', action='store_true')
    parser.add_argument('--target', type=int, default=DEFAULT_TARGET)
    parser.add_argument('--only', nargs='+')
    parser.add_argument('--publish', action='store_true', help='Create listings; omit for a queue preview without a connection')
    parser.add_argument('--all-sites', action='store_true', help='For this invocation, process the full pool even after the campaign target is reached')
    args = parser.parse_args()
    business, entries = load_workbook(args.workbook, args.sheet)
    if not args.workbook_sites_only:
        entries = merge_pool(entries, args.pool, args.workbook)
    only = [domain(value) for value in args.only] if args.only else None
    if only and set(only) - {entry['domain'] for entry in entries}:
        raise ValueError('--only includes a domain absent or disabled in the selected website pool')
    folder = campaign_folder(business, args.campaign)
    folder.mkdir(parents=True, exist_ok=True)
    with campaign_lock(folder / '.lock'):
        state_path = folder / 'state.json'
        state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
        configure_target(folder, args.target)
        seed_history(folder, state)
        save(state, folder, entries)
        if args.publish and not args.all_sites and verified_count(state) >= args.target:
            print(progress_message(state, args.target))
            return
        if not args.publish:
            for host in dict.fromkeys(entry['domain'] for entry in ranked_entries(entries, folder)):
                if not only or host in only:
                    previous = state.get(host, {})
                    ready = previous.get('status', 'not_run') in SAFE_TO_START and not previous.get('candidate_url')
                    action = 'needs mapping' if host not in SUPPORTED else 'recheck saved candidate' if previous.get('candidate_url') and previous.get('status') != 'published' else 'ready' if ready else 'skip: ' + previous.get('status', 'existing candidate')
                    print(host, action)
            print('Preview only. Use --publish after connecting Ui.Vision.')
            print(progress_message(state, args.target))
            return
        with UiVision() as client:
            status = tool_text(client.call('bridge_status'))
            if not bridge_connected(status) and 'wake channel' in status.lower():
                client.call('open_panel', {'target': 'chrome', 'why': 'Connect the local backlink publisher.'})
                status = tool_text(client.call('bridge_status'))
            if not bridge_connected(status):
                raise BridgeError('Connect Ui.Vision first: python uivision.py --connect; enable MCP bridge in its Settings > AI.')
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                try:
                    run_queue(client, browser, business, entries, state, folder, only, all_sites=args.all_sites)
                finally:
                    browser.close()
                    if not args.workbook_sites_only:
                        try:
                            refresh_pool(args.pool, campaign=folder)
                        except PermissionError:
                            print('Close Website_Pool.xlsx and run python website_pool.py --refresh to update its scores.')
    print(progress_message(state, args.target))
    print('Verified URLs:', folder / 'published_urls.txt')


if __name__ == '__main__':
    try:
        main()
    except (BridgeError, NeedsAttention, ValueError, FileNotFoundError) as exc:
        sys.exit(str(exc))
    except KeyboardInterrupt:
        sys.exit('Stopped. Submitting or uncertain entries will not be automatically repeated.')
