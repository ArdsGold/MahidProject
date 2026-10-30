"""Resumable Chrome layout inspection with authorized account access; no listing publication."""
import argparse
import csv
import io
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

from mappings.common import domain, NeedsAttention
from mappings.directories import DIRECTORY_INSPECTOR, DIRECTORY_SITES, submission_url
from mappings.registry import CLASSIFIEDS, DIRECTORIES, SUPPORTED
from template_detector import (configured, detect_forms, load_catalog, now,
                               observe_browser)
from uivision import BridgeError, UiVision, tool_text
from operator_notifications import operator_input

ROOT = Path(__file__).resolve().parent
LAYOUTS = ROOT / 'mappings' / 'layouts'
INSPECTOR = (ROOT / 'mappings' / 'layout_inspector.js').read_text(encoding='utf-8')


def write_record(record, folder=LAYOUTS):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (domain(record['domain']) + '.json')
    if path.exists():
        previous = json.loads(path.read_text(encoding='utf-8'))
        for key in ('assistant_review', 'previous_status', 'previous_access_reason', 'authentication_note',
                    'button_confirmation', 'route_checks'):
            if key in previous and key not in record:
                record[key] = previous[key]
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding='utf-8')
    temp.replace(path)


def read_record(host, folder=LAYOUTS):
    path = Path(folder) / (host + '.json')
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def navigation_signature(snap):
    """Compare observed navigation and form structure without client values or hostnames."""
    host = snap.get('host')
    def route(url):
        try:
            parsed = urlsplit(url)
            if parsed.scheme != 'https' or domain(url) != host or parsed.fragment:
                return None
        except ValueError:
            return None
        return parsed.path or '/', parsed.query
    controls = snap.get('controls', snap.get('links', []))
    if not controls or not route(snap.get('url', '')):
        return None
    signature = []
    for control in controls:
        target = route(control['url']) if control.get('url') else control.get('selector')
        if not target:
            return None
        signature.append((control['label'].strip().casefold(), target))
    forms = []
    for form in snap.get('forms', []):
        action = route(form.get('action', ''))
        if not action:
            return None
        fields = [{k: f.get(k) for k in ('name', 'tag', 'type', 'required', 'maxlength', 'selector', 'visible')}
                  for f in form.get('fields', [])]
        forms.append((form.get('method'), action, fields))
    return json.dumps([route(snap['url']), sorted(signature, key=str), forms], sort_keys=True)


def reuse_confirmation(host, snap, folder):
    signature = navigation_signature(snap)
    if not signature or snap.get('page_error') or snap.get('account_restricted'):
        return None
    for path in sorted(Path(folder).glob('*.json')):
        source = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(source, dict):
            continue
        confirmation = source.get('button_confirmation') or {}
        completed = source.get('completion_level', '').lower()
        if (source.get('domain') == host or confirmation.get('confirmed_by') != 'operator'
                or not (completed.startswith('final posting form reached') or 'independently verified' in completed)):
            continue
        for page in source.get('pages', []):
            if page.get('url') != confirmation.get('page') or navigation_signature(page) != signature:
                continue
            if navigation_signature(dict(page, controls=confirmation.get('controls', []))) != signature:
                continue
            return {'confirmed_utc': now(), 'page': snap['url'],
                    'controls': snap.get('controls', snap.get('links', [])),
                    'confirmed_by': 'validated_template', 'source_domain': source['domain'],
                    'evidence': 'Live navigation and form structure match an operator-confirmed completed workflow; publishing still requires live guards'}
    return None


def confirm_buttons(host, snap, record, prompt, folder=LAYOUTS):
    """Reuse an exact confirmed layout, otherwise ask about new or changed controls."""
    reused = reuse_confirmation(host, snap, folder)
    if reused:
        record['button_confirmation'] = reused
        return True
    controls = snap.get('controls', snap.get('links', []))
    record['button_candidates'] = controls
    labels = '; '.join(x['label'] + ' -> ' + (x.get('url') or x.get('selector', ''))
                       for x in controls) or 'No Register/Post controls detected'
    answer = prompt(host + ': First mapping: confirm the Register and Post/Add Listing controls in Chrome. '
                    + labels + '. Type confirm only if these cover the available routes (including confirmed absence); '
                    'otherwise type skip to save for review and identify the missing control with the assistant; stop pauses: ').strip().lower()
    if answer == 'stop':
        raise KeyboardInterrupt
    if answer == 'confirm':
        record['button_confirmation'] = {'confirmed_utc': now(), 'page': snap.get('url', ''),
                                         'controls': controls, 'confirmed_by': 'operator'}
        return True
    return False


def mark_access_gap(record, prompt):
    """Only explicit route evidence plus operator confirmation can establish a gap."""
    checks = record.get('route_checks', {})
    if not all(checks.get(route, {}).get('outcome') == 'blocked'
               and checks[route].get('evidence') for route in ('register', 'login', 'post')):
        raise ValueError('Recheck register, login and posting routes with evidence first')
    answer = prompt(record['domain'] + ': Register, login and posting routes were checked: '
                    + json.dumps(checks) + '. Type confirm access gap to confirm no usable posting route: ').strip().lower()
    if answer == 'confirm access gap':
        record.update(status='Access gap', access_gap_confirmed_utc=now())
    else:
        record['status'] = 'Needs review'
    return record


def layout_labels(host):
    r = read_record(host)
    return [r.get('status', 'Not inspected'), r.get('entry_url', ''), r.get('access', ''),
            'mappings/layouts/' + host + '.json' if r else '',
            r.get('review_reason', ''), r.get('completion_level',
                'Legacy inspection; button confirmation required' if r.get('pages') else 'Not inspected')]


def mark_review(record, reason):
    """Separate an automation limitation from a demonstrated account/site failure."""
    if 'not supported' in reason or 'needs a mapping' in reason:
        code = 'Unsupported account form'
    elif 'External sign-in' in reason:
        code = 'Unsupported external sign-in'
    elif 'entry point' in reason:
        code = 'Registration entry point not identified'
    else:
        code = 'Account outcome unconfirmed'
    record.update(status='Needs review', access=reason, review_reason=code,
                  verification_level='Automated checks only; access not independently confirmed',
                  missing_evidence='A confirmed signed-in posting page or an explicit site rejection explaining the block')
    record['review_evidence'] = {
        'observed_pages': [p.get('url', '') for p in record.get('pages', [])],
        'observed_form_count': sum(len(p.get('forms', [])) for p in record.get('pages', [])),
        'fields_and_selectors': 'See saved pages/forms; no field values retained',
    }
    return record


def initial_url(row):
    host = row['domain']
    if host in DIRECTORY_SITES:
        return submission_url(DIRECTORY_SITES[host])
    if configured(host)['family'] == 'php-directory' or 'dir' in host:
        return 'https://' + host + '/submit.php'
    if host in CLASSIFIEDS:
        return 'https://' + host + '/index.php?view=post&cityid=0&lang=en'
    return row['website'] if '://' in row['website'] else 'https://' + host + '/'


class WebsitePageError(BridgeError):
    def __init__(self, page):
        self.page = page
        super().__init__(page['page_error'])


def snapshot(client, url=None):
    script = ''
    if url:
        script += 'try {uiv.goto(' + json.dumps(url) + ');}catch(e){}\n'
    script += 'uiv.run("executeScript", ' + json.dumps('return (' + INSPECTOR + ')();') + ', "layout");'
    script += 'const data=JSON.stringify(uiv.getVar("layout"));for(let i=0;i<data.length;i+=1800)uiv.log("LAYOUT_PART:"+i+":"+data.slice(i,i+1800));'
    raw = tool_text(client.call('run_macro', {'script': script, 'look': 'none', 'log_limit': 180000}, timeout=180))
    matches = re.findall(r'LAYOUT_PART:(\d+):([^\n]*)', raw)
    if not matches:
        raise BridgeError('Layout inspection returned no complete result')
    page = json.loads(''.join(part.rstrip('\r') for _, part in sorted(matches, key=lambda x: int(x[0]))))
    if page.get('page_error'):
        raise WebsitePageError(page)
    return page


def native_check(client, host, snap):
    if not snap.get('native_present'):
        return None
    config = DIRECTORY_SITES.get(host) or {'domain': host, 'startingUrl': 'https://' + host + '/',
              'protocols': ['https:'], 'submitValue': snap.get('submit_label'),
              'optionalReciprocal': snap.get('reciprocal_present', False)}
    code = 'return (' + DIRECTORY_INSPECTOR + ')(' + json.dumps(config) + ');'
    raw = tool_text(client.call('run_macro', {'script': 'uiv.run("executeScript",' + json.dumps(code) + ',"v");uiv.log("GUARD:"+JSON.stringify(uiv.getVar("v")));', 'look': 'none', 'log_limit': 1500}))
    matches = re.findall(r'GUARD:(\{[^\n]*\})', raw)
    result = json.loads(matches[-1]) if matches else {'ok': False, 'reason': 'No guard result'}
    return {'config': config, 'result': result}


def form_structure(snap):
    # Keep the same fingerprint schema as HTTP and publisher observations.
    keys = ('name', 'tag', 'type', 'required', 'maxlength')
    return {'host': snap.get('host'), 'forms': [
        {'method': f['method'], 'fields': [{k: field.get(k) for k in keys} for field in f['fields']]}
        for f in snap.get('forms', [])]}


def blueprint(host, pages, native=None):
    latest = pages[-1] if pages else {}
    candidates = [(detect_forms(form_structure(p)['forms']), p) for p in pages]
    detected, best = max(candidates, key=lambda x: (x[0].get('match') or 0, bool(x[0].get('fingerprint')))) if candidates else ({}, {})
    family = detected.get('family', 'unknown')
    fields = {}
    if family == 'php-directory':
        fields = {'name': '[name="TITLE"]', 'website': '[name="URL"]', 'body': '[name="DESCRIPTION"]',
                  'public_email': '[name="OWNER_EMAIL"]', 'category': '[name="CATEGORY_ID"]'}
    elif family == 'xzero-classifieds':
        fields = {'name': '#adtitle', 'body': '[name="addesc"]', 'public_email': '#email'}
    if latest.get('access') != 'Accessible':
        status = 'Access check required'
    elif latest.get('unavailable'):
        status = 'Unavailable'
    elif family not in ('unknown', 'unmatched-form'):
        status = 'Form blueprint saved'
    elif any(p.get('links') for p in pages):
        status = 'Entry points saved; form incomplete'
    else:
        status = 'Needs deeper inspection'
    return {'domain': host, 'checked_utc': now(), 'status': status,
            'runtime': 'Mapped; live guards required' if host in SUPPORTED else 'Needs adapter',
            'family': family if family not in ('unknown', 'unmatched-form') else configured(host)['family'],
            'access': latest.get('access', 'Unknown'), 'entry_url': best.get('url', ''),
            'field_map': fields, 'native_guard': native,
            'pages': pages, 'publishing_enabled_by_inventory': False,
            'completion_level': 'Incomplete; requires operator button confirmation and final form inspection',
            'remaining': [] if host in SUPPORTED else ['Inspect free plan/category and publication receipt',
                         'Implement and offline-test a per-host route', 'Independently verify any later publication']}


def choose_entry(snap, visited):
    links = [x for x in snap.get('links', []) if x['url'] not in visited]
    # Prefer posting forms over account creation. Never submit a form to discover a page.
    def priority(link):
        if re.search(r'log\s*in|sign\s*in', link['label'], re.I):
            return 1
        return 2 if re.search(r'sign\s*up|register|account', link['label'], re.I) else 0
    links.sort(key=priority)
    return links[0]['url'] if links else None


def inspect_site(client, row, folder=LAYOUTS, prompt=operator_input, credentials=None):
    host = row['domain']
    pages, visited = [], set()
    url = initial_url(row)
    native = None
    saved_layout = read_record(host, folder)
    confirmation = saved_layout.get('button_confirmation')
    access_reason = None
    account_flow_attempted = False
    for step in range(8):
        snap = snapshot(client, url)
        if confirmation and snap.get('url') == confirmation.get('page'):
            prior = next((p for p in saved_layout.get('pages', []) if p.get('url') == snap['url']), None)
            if prior and navigation_signature(prior) != navigation_signature(snap):
                confirmation = None
                saved_layout['button_confirmation'] = None
                write_record(saved_layout, folder)
        if snap.get('account_restricted'):
            record = blueprint(host, pages + [snap] if snap.get('host') == host else pages)
            record.update(status='Skipped banned/suspended', access='Account banned or suspended; no replacement account attempted')
            write_record(record, folder)
            return record
        while snap.get('access') != 'Accessible' or snap.get('host') != host:
            same_host = snap.get('host') == host
            record = blueprint(host, pages + [snap] if same_host else pages)
            if not same_host:
                record.update(status='Access check required', access='External sign-in / redirect')
            write_record(record, folder)
            if host == 'medium.com':
                record.update(status='Deferred per preference', access='Medium remains skipped')
                write_record(record, folder)
                return record
            if snap.get('identity_check'):
                record.update(status='Skipped identity verification', access='Verify it is you; operator preference')
                write_record(record, folder)
                return record
            if same_host and snap.get('access') == 'Sign-in required' and not confirmation:
                if not confirm_buttons(host, snap, record, prompt, folder):
                    record.update(status='Needs button confirmation')
                    write_record(record, folder)
                    return record
                confirmation = record['button_confirmation']
                write_record(record, folder)
            if credentials and (snap.get('access') == 'Sign-in required' or not same_host):
                if account_flow_attempted:
                    mark_review(record, 'Account flow already inspected; no automatic login retry')
                    write_record(record, folder)
                    raise NeedsAttention(host + ': Account result needs inspection; no automatic login retry')
                account_flow_attempted = True
                # Login pages can omit signup links that were confirmed on the homepage.
                snap = dict(snap, links=list(snap.get('links', [])))
                for control in (confirmation or {}).get('controls', []):
                    if control.get('url') and control not in snap['links']:
                        snap['links'].append(control)
                from site_access import automate_access
                snap, reason = automate_access(client, host, snap, credentials, snapshot, prompt)
                if reason:
                    record = blueprint(host, pages + [snap] if snap.get('host') == host else pages)
                    if reason.startswith('Banned or suspended'):
                        record.update(status='Skipped banned/suspended', access=reason)
                    elif reason.startswith('Email already registered'):
                        record.update(status='Skipped registered email', access=reason)
                    else:
                        mark_review(record, reason)
                        # A login automation limitation does not rule out a posting route.
                        visited.add(snap.get('url', ''))
                        account_urls = {link['url'] for page in pages + [snap] for link in page.get('links', [])
                                        if re.search(r'/(?:login|sign-in|signup|sign-up|register|registration|profile)(?:\.aspx|\.php)?/?$',
                                                     urlsplit(link['url']).path, re.I)}
                        next_url = next((candidate for page in reversed(pages + [snap])
                                         if (candidate := choose_entry(page, visited | account_urls))), None)
                        if next_url:
                            access_reason = reason
                            pages = record['pages']
                            url = next_url
                            break
                    write_record(record, folder)
                    if not reason.startswith(('Banned or suspended', 'Email already registered')):
                        raise NeedsAttention(host + ': Account result needs inspection; progress saved, no account action will be repeated')
                    return record
                continue
            answer = prompt(host + ': ' + record['access'] + '. Complete it in Chrome and return to this website, then Enter to inspect; skip or stop: ').strip().lower()
            if answer == 'stop':
                raise KeyboardInterrupt
            if answer == 'skip':
                record.update(status='Deferred by operator', deferred_utc=now())
                write_record(record, folder)
                return record
            snap = snapshot(client)  # Keep the operator's completed page; never reload it.
            if snap.get('host') != host:
                continue  # Operator may still be finishing external sign-in.
        if snap.get('access') != 'Accessible' or snap.get('host') != host:
            continue  # Follow the observed alternate route after unresolved authentication.
        if snap.get('account_restricted'):
            record = blueprint(host, pages + [snap] if snap.get('host') == host else pages)
            record.update(status='Skipped banned/suspended', access='Account banned or suspended; no replacement account attempted')
            write_record(record, folder)
            return record
        pages.append(snap)
        visited.add(snap.get('url', url))
        if not confirmation:
            record = blueprint(host, pages, native)
            record.update(status='Needs button confirmation', button_candidates=snap.get('controls', snap.get('links', [])))
            write_record(record, folder)
            if not confirm_buttons(host, snap, record, prompt, folder):
                record.update(status='Needs button confirmation')
                write_record(record, folder)
                return record
            confirmation = record['button_confirmation']
            write_record(record, folder)
        detected = detect_forms(form_structure(snap)['forms'])
        observe_browser(host, form_structure(snap))
        if detected.get('family') in ('php-directory', 'xzero-classifieds'):
            native = native_check(client, host, snap)
            break
        url = choose_entry(snap, visited)
        if not url and step == 0 and '/submit.php' in initial_url(row) and detected.get('family') not in ('php-directory', 'xzero-classifieds'):
            url = 'https://' + host + '/'
        if not url:
            break
    record = blueprint(host, pages, native)
    record['navigation_recipe'] = [{'step': i + 1, 'page': page.get('url', ''),
                                    'observed_controls': page.get('controls', page.get('links', []))}
                                   for i, page in enumerate(pages)]
    if confirmation:
        record['button_confirmation'] = confirmation
    if access_reason:
        mark_review(record, access_reason)
    classified_form = any({'adtitle', 'addesc'} <= {f.get('name') for f in form.get('fields', [])}
                          for page in pages if page.get('access') == 'Accessible'
                          for form in page.get('forms', []))
    if confirmation and ((native and native.get('result', {}).get('ok')) or classified_form):
        record['completion_level'] = 'Final posting form reached; publication untested'
    elif confirmation:
        record['completion_level'] = 'Buttons confirmed; final posting form not validated'
    write_record(record, folder)
    return record


def export_index(rows, folder=LAYOUTS):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(['domain', 'layout_status', 'family', 'runtime', 'entry_url', 'access', 'blueprint', 'review_reason', 'verification_level', 'completion_level', 'buttons_confirmed'])
    totals = Counter()
    for row in rows:
        host = row['domain']
        r = read_record(host, folder)
        status = r.get('status', 'Not inspected')
        totals[status] += 1
        values = [host, status, r.get('family', configured(host)['family']),
                  r.get('runtime', 'Mapped; live guards required' if host in SUPPORTED else 'Needs adapter'),
                  r.get('entry_url', ''), r.get('access', ''), host + '.json' if r else '',
                  r.get('review_reason', ''), r.get('verification_level', ''),
                  r.get('completion_level', 'Legacy inspection; button confirmation required' if r.get('pages') else 'Not inspected'),
                  'Yes' if r.get('button_confirmation') else 'No']
        writer.writerow(["'" + x if isinstance(x, str) and x.startswith(('=', '+', '-', '@')) else x for x in values])
    (folder / 'index.csv').write_text('\ufeff' + stream.getvalue(), encoding='utf-8')
    (folder / 'progress.json').write_text(json.dumps(dict(totals), indent=2), encoding='utf-8')
    return totals


def main():
    from website_pool import DEFAULT_POOL, read_pool, refresh_pool
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', type=Path, default=DEFAULT_POOL)
    parser.add_argument('--browser', action='store_true', help='Inspect in regular Chrome; no publishing')
    parser.add_argument('--only', nargs='+')
    parser.add_argument('--reinspect', action='store_true')
    parser.add_argument('--workbook', type=Path, default=ROOT / '.local/workbooks/Cheer_Athletics_St_Louis.xlsx',
                        help='Private workbook containing the operator-authorized shared account')
    args = parser.parse_args()
    rows = read_pool(args.pool)
    selected = {domain(x) for x in args.only} if args.only else {r['domain'] for r in rows}
    if selected - {r['domain'] for r in rows}:
        parser.error('--only contains a website absent from the pool')
    # Known forms without adapters are quick reusable mapping wins; inspect every site eventually.
    catalog = load_catalog()
    for row in rows:
        host = row['domain']
        if not read_record(host):
            evidence = catalog.get(host, {})
            write_record({'domain': host, 'status': 'Not inspected', 'known_template': configured(host),
                          'saved_structure': {k: evidence[k] for k in ('family', 'fingerprint', 'basis', 'source') if k in evidence},
                          'runtime': 'Mapped; live guards required' if host in SUPPORTED else 'Needs adapter',
                          'publishing_enabled_by_inventory': False})
    queue = sorted(rows, key=lambda r: (r['domain'] in SUPPORTED,
                   catalog.get(r['domain'], {}).get('family') != 'php-directory'))
    if args.browser:
        from site_access import shared_credentials
        credentials = shared_credentials(args.workbook)
        with UiVision() as client:
            for row in queue:
                host = row['domain']
                if host not in selected or row['enabled'] != 'Yes':
                    continue
                previous = read_record(host)
                needs_confirmation = bool(previous.get('pages')) and not previous.get('button_confirmation') and previous.get('status') not in (
                    'Deferred by operator', 'Deferred per preference', 'Skipped identity verification', 'Skipped banned/suspended', 'Inspection error')
                if previous.get('status') not in (None, 'Not inspected', 'Access check required', 'Needs button confirmation') and not args.reinspect and not needs_confirmation:
                    continue
                print('Inspecting', host, flush=True)
                try:
                    record = inspect_site(client, row, credentials=credentials)
                    print(host, record['status'], flush=True)
                except KeyboardInterrupt:
                    export_index(rows)
                    refresh_pool(args.pool)
                    raise
                except NeedsAttention as exc:
                    print(str(exc), flush=True)
                    export_index(rows)
                    refresh_pool(args.pool)
                    break
                except Exception as exc:
                    record = read_record(host)
                    record.update(domain=host, status='Inspection error', reason=type(exc).__name__,
                                  checked_utc=now(), publishing_enabled_by_inventory=False,
                                  completion_level='Inspection failed; final posting form not validated')
                    if isinstance(exc, WebsitePageError):
                        record.setdefault('pages', []).append(exc.page)
                        record.update(review_reason=exc.page['page_error'], error_page=exc.page['url'],
                                      verification_level='Live explicit error page; automatically skipped per operator preference')
                    write_record(record)
                    print(host, 'Inspection error', type(exc).__name__, flush=True)
                export_index(rows)
    totals = export_index(rows)
    refresh_pool(args.pool)
    print('Layout inventory:', dict(totals), flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('Mapping paused; saved layouts retained. No publication performed.', flush=True)
