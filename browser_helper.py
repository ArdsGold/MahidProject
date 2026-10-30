"""Exchange public business data and result URLs with Ui.Vision; never submit forms."""
import argparse
import csv
import io
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

from backlinks import (NeedsAttention, atomic_write, campaign_folder, campaign_lock, check_public_url,
                       content, domain, load_workbook, save, stamp, verify)
from workbook_layout import FIELDS
from mappings.pastelink import macro_commands
from mappings.common import content_parts
from website_pool import (DEFAULT_POOL, DEFAULT_TARGET, merge_pool, ranked_entries,
                          begin_attempt, ensure_attempt, seed_history, configure_target, target_for,
                          verified_count, refresh_pool)


RESULT_FIELDS = ('campaign_id', 'domain', 'outcome', 'public_url')
BUSINESS_FIELDS = list(dict.fromkeys([key for _, key, _, _ in FIELDS] + ['address', 'hours']))
QUEUE_FIELDS = ['campaign_id', 'domain', 'previous_status', 'action'] + BUSINESS_FIELDS + ['combined_content', 'omitted_fields']
REVIEW_STATUSES = {'pending', 'submitting', 'uncertain', 'manual_review', 'unverified', 'rejected'}


def write_csv(path, rows):
    output = io.StringIO(newline='')
    csv.writer(output).writerows(rows)
    atomic_write(path, output.getvalue())


def write_macro(path, commands):
    macro = {'Name': path.stem, 'CreationDate': stamp()[:10], 'Commands': [
        {'Command': command, 'Target': target, 'Value': value, 'Description': ''}
        for command, target, value in commands
    ]}
    atomic_write(path, json.dumps(macro, indent=2, ensure_ascii=False))


def export_queue(business, entries, state, folder, only=None):
    """Export data only. No credentials, network access, journal changes or submission."""
    helper = folder / 'helper'
    helper.mkdir(parents=True, exist_ok=True)
    rows = []
    seen = set()
    for entry in ranked_entries(entries, folder):
        if verified_count(state) >= target_for(folder):
            break
        host = entry['domain']
        if host in seen or (only and host not in only):
            continue
        seen.add(host)
        previous = state.get(host, {})
        if previous.get('status') == 'published':
            continue
        status = previous.get('status', 'not_run')
        action = 'review' if status in REVIEW_STATUSES or previous.get('candidate_url') else 'new'
        rows.append([folder.name, host, status, action] + [business.get(key, '') for key in BUSINESS_FIELDS] +
                    [content(business)[0], '; '.join(content_parts(business)['omitted_fields'])])
    write_csv(helper / 'helper_queue.csv', [QUEUE_FIELDS, *rows])
    write_csv(helper / 'helper_results_template.csv', [RESULT_FIELDS])
    # Keep a stable one-row, headerless input so the pilot needs no loop or column guessing.
    pilot = next((row for row in rows if row[1] == 'pastelink.net'), None)
    pilot_files = ['pastelink_job.csv', 'Pastelink_Fill.json', 'Pastelink_Capture_URL.json']
    if pilot:
        body = content(business)[0]
        write_csv(helper / pilot_files[0], [[folder.name, 'pastelink.net', business['name'], body,
                                           len(body.encode('utf-16-le')) // 2,
                                           '; '.join(content_parts(business)['omitted_fields']) or 'None']])
        fill, capture = macro_commands()
        write_macro(helper / pilot_files[1], fill)
        write_macro(helper / pilot_files[2], capture)
    else:
        # A later export must not leave a runnable pilot for an already completed site.
        for name in pilot_files:
            (helper / name).unlink(missing_ok=True)
    return helper, len(rows)


def read_results(path, campaign_id, entries):
    """Validate the whole batch before changing the campaign journal."""
    with path.open(encoding='utf-8-sig', newline='') as source:
        rows = [row for row in csv.reader(source) if any(cell.strip() for cell in row)]
    if rows and tuple(rows[0]) == RESULT_FIELDS:
        rows = rows[1:]
    allowed = {entry['domain'] for entry in entries}
    results = []
    seen = {}
    for number, row in enumerate(rows, 1):
        if len(row) != len(RESULT_FIELDS):
            raise ValueError(f'Result row {number}: expected four columns: ' + ', '.join(RESULT_FIELDS))
        key, host, outcome, url = (value.strip() for value in row)
        if key != campaign_id:
            raise ValueError(f'Result row {number}: different business or campaign; export a fresh queue.')
        host = domain(host)
        if host not in allowed:
            raise ValueError(f'Result row {number}: domain is absent from this workbook.')
        if outcome not in ('candidate', 'pending', 'skip'):
            raise ValueError(f'Result row {number}: outcome must be candidate, pending or skip.')
        if outcome == 'candidate':
            if urlsplit(url).scheme not in ('http', 'https'):
                raise ValueError(f'Result row {number}: provide a complete public HTTP(S) URL.')
            check_public_url(url, host)
        elif url:
            raise ValueError(f'Result row {number}: leave public_url blank for pending or skip.')
        value = (host, outcome, url)
        if host in seen:
            if seen[host] != value:
                raise ValueError('Conflicting results for one domain; import one public URL per domain.')
            continue
        seen[host] = value
        results.append(value)
    return results


def import_results(results, business, entries, state, folder, browser):
    for host, outcome, url in results:
        if verified_count(state) >= target_for(folder):
            break
        if state.get(host, {}).get('status') == 'published' or outcome == 'skip':
            continue
        previous = state.get(host, {})
        if not previous.get('candidate_url') and previous.get('status') != 'pending':
            begin_attempt(folder, host)
        else:
            ensure_attempt(folder, host)
        if outcome == 'pending':
            # Keep existing candidate/recovery information for submissions awaiting approval.
            state.setdefault(host, {}).update(status='pending', reason='Ui.Vision: awaiting site approval', checked_utc=stamp())
        else:
            # Journal the public candidate before verification so interruptions do not lose it.
            state[host] = {'status': 'unverified', 'candidate_url': url,
                           'reason': 'Ui.Vision public URL awaiting independent verification', 'checked_utc': stamp()}
            save(state, folder, entries)
            try:
                verified = verify(browser, url, business, host)
                check_public_url(verified['url'], host)
                state[host] = verified
            except Exception:
                state[host].update(reason='Public page could not be verified. Reimport this result to retry; no new submission is needed.', checked_utc=stamp())
        save(state, folder, entries)
        print(host, state[host]['status'], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--sheet')
    parser.add_argument('--campaign', default='default')
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--workbook-sites-only', action='store_true')
    parser.add_argument('--target', type=int, default=DEFAULT_TARGET)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--export', action='store_true', help='Export public data and the Pastelink pilot; no network or publishing')
    action.add_argument('--import-results', type=Path, help='Verify captured public URLs and update the existing campaign')
    parser.add_argument('--only', nargs='+', help='Limit queue export to these workbook domains')
    args = parser.parse_args()
    business, entries = load_workbook(args.workbook, args.sheet)
    if not args.workbook_sites_only:
        entries = merge_pool(entries, args.pool, args.workbook)
    only = [domain(host) for host in args.only] if args.only else None
    if only and (args.import_results or set(only) - {entry['domain'] for entry in entries}):
        raise ValueError('--only is for export and must name domains in the workbook.')
    folder = campaign_folder(business, args.campaign)
    folder.mkdir(parents=True, exist_ok=True)
    with campaign_lock(folder / '.lock'):
        path = folder / 'state.json'
        state = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        if args.export:
            helper, count = export_queue(business, entries, state, folder, only)
            print(f'Exported {count} unfinished domains. No sites opened or submitted.\nFiles: {helper}')
            return
        configure_target(folder, args.target)
        seed_history(folder, state)
        results = read_results(args.import_results, folder.name, entries)
        needs_browser = any(outcome == 'candidate' and state.get(host, {}).get('status') != 'published' for host, outcome, _ in results)
        if needs_browser:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                try:
                    import_results(results, business, entries, state, folder, browser)
                finally:
                    browser.close()
        else:
            import_results(results, business, entries, state, folder, None)
        if not args.workbook_sites_only:
            refresh_pool(args.pool, campaign=folder)
    print(f'Verified public URLs: {folder / "published_urls.txt"}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, FileNotFoundError, KeyError, NeedsAttention) as exc:
        sys.exit(str(exc))
    except KeyboardInterrupt:
        sys.exit('Stopped. Saved candidates can be reimported without submitting again.')
