"""Operator-authorized shared-account access. Never publishes business listings."""
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

from template_detector import now
from uivision import BridgeError, tool_text
from operator_notifications import operator_input, check_cancelled

ROOT = Path(__file__).resolve().parent
ACCESS_DIR = ROOT / '.local' / 'site-access'


def shared_credentials(workbook):
    from backlinks import load_workbook
    business, rows = load_workbook(workbook)
    accounts = {(r.get('username', ''), r.get('login_email', ''), r.get('password', ''))
                for r in rows if r.get('password') and (r.get('username') or r.get('login_email'))}
    if len(accounts) != 1:
        raise ValueError('The shared workbook account is missing or ambiguous; credentials were not printed.')
    username, email, password = next(iter(accounts))
    return {'username': username or email, 'email': email or username, 'password': password,
            'business_name': business.get('name', ''),
            'blog_name': re.sub(r'[^A-Za-z0-9]', '', business.get('name', ''))}


def private_save(host, record, folder=ACCESS_DIR):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (host + '.json')
    temp = path.with_suffix('.json.tmp')
    temp.write_text(json.dumps(record, indent=2), encoding='utf-8')
    temp.replace(path)


def private_load(host, folder=ACCESS_DIR):
    path = Path(folder) / (host + '.json')
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def contract(snap, registering=False):
    """Recognize actual account controls, never guess personal names or required answers."""
    matches = []
    for form in snap.get('forms', []):
        fields = [x for x in form['fields'] if x.get('visible')]
        by_name = {x['name']: x for x in fields}
        if registering and {'usr', 'email', 'pass', 'signup'} <= by_name.keys():
            mapping = {'usr': 'username', 'email': 'email', 'pass': 'password'}
            submit = 'signup'
        elif (registering and {'username', 'email', 'password', 'signup'} <= by_name.keys()
              and urlsplit(form.get('action', '')).path == '/register'
              and all(by_name[name].get('label', '').strip().lower() == label for name, label in
                      (('username', 'blog name'), ('email', 'your email'), ('password', 'password')))
              and by_name['username'].get('type') == by_name['email'].get('type') == 'email'
              and by_name['password'].get('type') == 'password'):
            mapping, submit = {'username': 'blog_name', 'email': 'email', 'password': 'password'}, 'signup'
        elif (registering and form.get('account_family') == 'blog-address-signup'
              and {'username', 'email', 'password', 'signup'} <= by_name.keys()
              and urlsplit(form.get('action', '')).path == '/signup'
              and by_name['username'].get('type') == 'text'
              and by_name['email'].get('type') == 'email'
              and by_name['password'].get('type') == 'password'):
            mapping, submit = {'username': 'blog_name', 'email': 'email', 'password': 'password'}, 'signup'
        elif (registering and {'LOGIN', 'EMAIL', 'PASSWORD', 'PASSWORDC', 'CAPTCHA', 'send'} <= by_name.keys()
              and urlsplit(form.get('action', '')).path == '/user/register'
              and all(by_name[n].get('type') == 'password' for n in ('PASSWORD', 'PASSWORDC'))):
            mapping = {'LOGIN':'username', 'EMAIL':'email', 'PASSWORD':'password', 'PASSWORDC':'password'}
            submit = 'send'
        elif (registering and {'LOGIN', 'NAME', 'EMAIL', 'PASSWORD', 'PASSWORDC', 'CAPTCHA', 'send'} <= by_name.keys()
              and urlsplit(form.get('action', '')).path == '/profile.php'
              and all(by_name[n].get('type') == 'password' for n in ('PASSWORD', 'PASSWORDC'))):
            mapping = {'LOGIN':'username', 'NAME':'business_name', 'EMAIL':'email',
                       'PASSWORD':'password', 'PASSWORDC':'password'}
            submit = 'send'
        elif not registering and {'usr', 'pass', 'login'} <= by_name.keys():
            mapping, submit = {'usr': 'username', 'pass': 'password'}, 'login'
        elif (not registering and {'username', 'password', 'login'} <= by_name.keys()
              and urlsplit(form.get('action', '')).path in ('/login', '/sign-in')
              and by_name['password'].get('type') == 'password'):
            mapping, submit = {'username': 'email' if by_name['username'].get('type') == 'email' else 'username',
                               'password': 'password'}, 'login'
        elif (not registering and {'user', 'pass', 'submit'} <= by_name.keys()
              and urlsplit(form.get('action', '')).path == '/login'
              and by_name['pass'].get('type') == 'password'):
            mapping, submit = {'user': 'username', 'pass': 'password'}, 'submit'
        elif (not registering and {'user', 'pass', 'login'} <= by_name.keys()
              and urlsplit(form.get('action', '')).path == '/login.php'
              and by_name['pass'].get('type') == 'password'):
            mapping, submit = {'user': 'username', 'pass': 'password'}, 'login'
        elif not registering:
            email = next((x['name'] for x in fields if x['name'].endswith('$LoginForm1$Email')), None)
            password = next((x['name'] for x in fields if x['name'].endswith('$LoginForm1$Password')), None)
            submit = next((x['name'] for x in fields if x['name'].endswith('$LoginForm1$Login')), None)
            if not all((email, password, submit)):
                continue
            mapping = {email: 'email', password: 'password'}
        else:
            continue
        action = urlsplit(form.get('action', ''))
        if (form.get('method') != 'post' or action.scheme != 'https' or action.hostname is None
                or action.hostname.removeprefix('www.') != snap['host']
                or any(x.get('required') and x['name'] not in mapping and x['name'] != submit
                       and not (registering and submit == 'send' and x['name'] == 'CAPTCHA') for x in fields)
                or any(len([x for x in fields if x['name'] == name]) != 1 for name in (*mapping, submit))
                or by_name[submit].get('type') != 'submit'):
            continue
        matches.append({'values': {by_name[name]['selector']: key for name, key in mapping.items()},
                        'submit': by_name[submit]['selector'], 'action': form['action'],
                        'uncheck': by_name['ckb']['selector'] if registering and 'ckb' in by_name and not by_name['ckb'].get('required') else
                            by_name['rememberMe']['selector'] if not registering and 'rememberMe' in by_name and not by_name['rememberMe'].get('required') else None})
    return matches[0] if len(matches) == 1 else None


AUTH_FLAGS_JS = r'''const t=document.body.innerText; const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
      const custom_captcha=[...document.querySelectorAll('#captcha_window,.captcha_checkbox,#KEY-Captcha,#logo_key_captcha')].some(visible) ||
          [...document.querySelectorAll('input[name="CAPTCHA"]')].some(visible) &&
          [...document.querySelectorAll('img[src*="captcha.php"]')].some(visible);
      const standard_captcha=/captcha.*(invalid|incorrect|required|failed)|complete.*captcha|verify.*not a robot/i.test(t) ||
          [...document.querySelectorAll('.g-recaptcha,.h-captcha,.cf-turnstile,iframe[src*="bframe"]')].some(e=>visible(e)&&
          ![...document.querySelectorAll('[name="g-recaptcha-response"],[name="h-captcha-response"],[name="cf-turnstile-response"]')].some(x=>x.value.trim()));
      return {identity:/verify it.s you/i.test(t),
        authenticated_navigation:[...document.querySelectorAll('a[href]')].some(a=>visible(a) && /^(log\s*out|sign\s*out)$/i.test(a.textContent.trim()) && new URL(a.href,location.href).origin===location.origin),
        account_restricted:/\b(?:your|this|the)\s+(?:account|site|blog)\s+(?:(?:has been|is|was)\s+)?(?:(?:permanently|temporarily)\s+)?(?:banned|suspended|disabled)\b|\baccount\s*(?:status\s*:\s*)?(?:(?:permanently|temporarily)\s+)?(?:suspended|banned|disabled)\b|\byou have been banned\b/i.test(t),
        email_verification:/verify your email|activation (email|link)|check your (email|inbox)|confirm your email/i.test(t),
        captcha:custom_captcha||standard_captcha, custom_captcha, standard_captcha,
        payment:!!document.querySelector('input[name*="credit"],input[name*="payment"],input[name*="cardnumber"],input[name*="billing"]'),
        wrong_password:/incorrect password|invalid password|wrong password/i.test(t),
        invalid_login:/invalid login|invalid credentials|incorrect credentials|no (?:such )?(?:user|account)|(?:username|account) (?:does not exist|not found)/i.test(t),
        username_exists:/username\s+(?:already\s+)?(?:exists|taken|in use)/i.test(t),
        email_exists:/email(?:\s+address)?\s+(?:is\s+|has\s+been\s+)?(?:already\s+)?(?:registered|exists|taken|in use)/i.test(t),
        registration_rejected:/already (registered|exists|taken|in use)|username.*taken|email.*in use/i.test(t)};'''


def auth_flags(client):
    raw = tool_text(client.call('run_macro', {'script': 'uiv.run("executeScript",' + json.dumps(AUTH_FLAGS_JS) + ',"v");uiv.log("ACCESS_FLAGS:"+JSON.stringify(uiv.getVar("v")));', 'look': 'none', 'log_limit': 1300}))
    match = re.findall(r'ACCESS_FLAGS:(\{[^\n]*\})', raw)
    if not match:
        raise BridgeError('Access result could not be inspected')
    return json.loads(match[-1])


def inspect_account_result(client, host, snap, flags, read_snapshot):
    """Inspect delayed account responses without navigation, typing or another click."""
    clear = ('authenticated_navigation', 'account_restricted', 'identity', 'payment',
             'email_verification', 'invalid_login', 'wrong_password', 'username_exists',
             'email_exists', 'registration_rejected', 'standard_captcha')
    started = time.monotonic()
    deadline = started + 20
    reads = 0
    for _ in range(20):
        if snap.get('host') != host or any(flags.get(key) for key in clear) or time.monotonic() >= deadline:
            break
        check_cancelled()
        time.sleep(0.5)
        check_cancelled()
        snap = read_snapshot(client)
        flags = auth_flags(client)
        reads += 1
        if any(flags.get(key) for key in clear):
            flags['inspection_resolution'] = 'Delayed account response resolved by read-only reinspection'
    flags['inspection_reads'] = reads
    flags['inspection_elapsed_ms'] = round((time.monotonic() - started) * 1000)
    return snap, flags


def submit_account(client, snap, spec, credentials, click=True, fill=True):
    check_cancelled()
    # Validate origin/action/controls again before typing, then click only the known account button.
    selectors = [*spec['values'], spec['submit']]
    guard = ('return location.hostname.toLowerCase().replace(/^www\\./,"")===' + json.dumps(snap['host']) +
             ' && location.protocol==="https:" && ' + ' && '.join(
                 'document.querySelectorAll(' + json.dumps(s) + ').length===1' for s in selectors) +
             ' && document.querySelector(' + json.dumps(spec['submit']) + ').form.action===' + json.dumps(spec['action']) + ';')
    if not fill:
        checks = ['document.querySelector(' + json.dumps(s) + ').value===' + json.dumps(credentials[key])
                  for s, key in spec['values'].items()]
        if spec.get('uncheck'):
            checks.append('!document.querySelector(' + json.dumps(spec['uncheck']) + ').checked')
        guard = guard[:-1] + ' && ' + ' && '.join(checks) + ';'
    script = 'uiv.run("executeScript",' + json.dumps(guard) + ',"valid");if(!uiv.getVar("valid"))throw Error("Account form changed");'
    if fill:
        for selector, key in spec['values'].items():
            script += 'uiv.run("type",' + json.dumps('css=' + selector) + ',' + json.dumps(credentials[key]) + ');'
    if fill and spec.get('uncheck'):
        script += 'uiv.run("uncheck",' + json.dumps('css=' + spec['uncheck']) + ');'
    if click:
        script += 'uiv.run("click",' + json.dumps('css=' + spec['submit']) + ');'
    # The bridge's raw command log contains typed secrets: keep it in memory, never print/export it.
    client.call('run_macro', {'script': script, 'look': 'none', 'log_limit': 100}, timeout=180)


def automate_access(client, host, snap, credentials, read_snapshot, prompt=operator_input, folder=ACCESS_DIR):
    """One submission per account stage; uncertain outcomes never trigger another click."""
    record = private_load(host, folder)
    attempts = record.setdefault('account_attempts', {})
    # Older checkpoints did not record a receipt. Do not replay their login on upgrade.
    if not attempts and ((record.get('stage') == 'login' and record.get('checked_utc'))
                         or record.get('registration') == 'rejected'):
        attempts['login'] = 'uncertain'
        private_save(host, record, folder)

    def restricted(flags):
        if not flags.get('account_restricted'):
            return False
        record.update(status='skipped_restricted_account', checked_utc=now())
        private_save(host, record, folder)
        return True

    if record.get('status') == 'skipped_restricted_account':
        return snap, 'Banned or suspended account; website skipped per operator preference'
    if record.get('status') == 'skipped_registered_email':
        return snap, 'Email already registered; website skipped per operator preference'
    flags = auth_flags(client)
    if restricted(flags):
        return snap, 'Banned or suspended account; website skipped per operator preference'
    if snap.get('host') == host and flags.get('authenticated_navigation'):
        return snap, ''
    if record.get('registration') in ('submitting', 'uncertain', 'email_verification', 'completed'):
        return snap, 'Account registration already attempted; protected from repeat submission'

    # Keep observed registration routes when the login response omits its navigation.
    signup = next((x['url'] for x in snap.get('links', [])
                   if re.search(r'sign\s*up|register|^create one$', x['label'], re.I)), None)
    signup = signup or record.get('registration_url')
    if signup:
        record['registration_url'] = signup
        private_save(host, record, folder)
    stages = ['login', 'registration']
    for stage in stages:
        registering = stage.startswith('registration')
        variant = int(stage.split(':')[1]) if ':' in stage else 0
        previous = attempts.get(stage)
        if previous:
            if stage == 'login' and previous == 'rejected':
                continue
            if (registering and previous == 'rejected' and variant < 3
                    and record.get('account_attempt_reasons', {}).get(stage) == 'username_exists'):
                stages.append('registration:' + str(variant + 1))
                continue
            return snap, 'Account action already attempted; inspect saved result before continuing'
        if registering:
            if not signup:
                return snap, 'No recognized free registration entry point'
            snap = read_snapshot(client, signup)
        elif snap.get('host') == host and not contract(snap):
            login = next((x['url'] for x in snap.get('links', [])
                          if re.search(r'log\s*in|sign\s*in', x['label'], re.I)), None)
            if login:
                snap = read_snapshot(client, login)
        if snap.get('host') != host:
            return snap, 'External sign-in requires a provider-specific mapping'
        spec = contract(snap, registering)
        if not spec:
            return snap, 'Account form is not supported by the current adapter; access has not been ruled out'
        stage_credentials = dict(credentials)
        if variant:
            if 'blog_name' not in spec['values'].values() or not credentials.get('blog_name'):
                return snap, 'Taken blog name needs an inspected blog-name field; inspect before changing account identity'
            stage_credentials['blog_name'] = credentials['blog_name'] + chr(ord('A') + variant - 1)
        if registering and 'blog_name' in spec['values'].values() and stage_credentials.get('blog_name'):
            record['blog_name'] = stage_credentials['blog_name']
        flags = auth_flags(client)
        if restricted(flags):
            return snap, 'Banned or suspended account; website skipped per operator preference'
        if flags.get('identity') or flags.get('payment'):
            return snap, 'Identity or payment restriction; no account submission'
        submit_account(client, snap, spec, stage_credentials, click=False)
        snap = read_snapshot(client)
        flags = auth_flags(client)
        if restricted(flags):
            return snap, 'Banned or suspended account; website skipped per operator preference'
        if flags.get('identity') or flags.get('payment'):
            return snap, 'Identity or payment restriction; no account submission'
        if flags.get('captcha'):
            answer = prompt(host + ': Account CAPTCHA. Complete it in Chrome, then Enter; skip or stop: ').strip().lower()
            if answer == 'stop':
                raise KeyboardInterrupt
            if answer == 'skip':
                return snap, 'Account CAPTCHA deferred by operator'
            snap = read_snapshot(client)
            flags = auth_flags(client)
            if restricted(flags):
                return snap, 'Banned or suspended account; website skipped per operator preference'
            if flags.get('identity') or flags.get('payment'):
                return snap, 'Identity or payment restriction; no account submission'
            if flags.get('captcha') and not (flags.get('custom_captcha') and not flags.get('standard_captcha')):
                return snap, 'Account CAPTCHA remains incomplete; no submission made'
        # Persist before the only click. A crash or ambiguous receipt cannot repeat it.
        attempts[stage] = 'submitting'
        record.update(stage=stage, checked_utc=now())
        if registering:
            record['registration'] = 'submitting'
        private_save(host, record, folder)
        try:
            submit_account(client, snap, spec, stage_credentials, fill=False)
            snap = read_snapshot(client)
            flags = auth_flags(client)
            snap, flags = inspect_account_result(client, host, snap, flags, read_snapshot)
        except BaseException:
            attempts[stage] = 'uncertain'
            if registering:
                record['registration'] = 'uncertain'
            private_save(host, record, folder)
            raise
        attempts[stage] = 'uncertain'
        record['last_account_response'] = {'path': urlsplit(snap.get('url', '')).path, 'flags': flags}
        if flags.get('inspection_resolution'):
            record['validated_inspection_rule'] = flags['inspection_resolution']
        if registering:
            record['registration'] = 'rejected' if flags.get('registration_rejected') else 'uncertain'
        private_save(host, record, folder)
        if restricted(flags):
            return snap, 'Banned or suspended account; website skipped per operator preference'
        if registering and flags.get('email_exists'):
            attempts[stage] = 'rejected'
            record.update(status='skipped_registered_email', registration='rejected')
            private_save(host, record, folder)
            return snap, 'Email already registered; website skipped per operator preference'
        if flags.get('identity'):
            return snap, 'Verify it is you; skipped per operator preference'
        if flags.get('email_verification'):
            if registering:
                record['registration'] = 'email_verification'
                private_save(host, record, folder)
            answer = prompt(host + ': Email verification required. Verify in Chrome, then Enter; skip or stop: ').strip().lower()
            if answer == 'stop':
                raise KeyboardInterrupt
            if answer == 'skip':
                return snap, 'Email verification deferred by operator'
            snap = read_snapshot(client)
            flags = auth_flags(client)
            if restricted(flags):
                return snap, 'Banned or suspended account; website skipped per operator preference'
        if snap.get('host') == host and flags.get('authenticated_navigation') and not flags.get('standard_captcha'):
            attempts[stage] = 'completed'
            record.update(status='signed_in', signed_in_evidence='Visible same-site sign-out control after account action')
            if registering:
                record['registration'] = 'completed'
            private_save(host, record, folder)
            return snap, ''
        # Explicit site rejections allow a different stage, never a repeat of this one.
        if registering and flags.get('username_exists'):
            attempts[stage] = 'rejected'
            record.setdefault('account_attempt_reasons', {})[stage] = 'username_exists'
            private_save(host, record, folder)
            if variant >= 3:
                return snap, 'Three modified blog names rejected; stop for inspection'
            stages.append('registration:' + str(variant + 1))
            continue
        if stage == 'login' and (flags.get('invalid_login') or flags.get('wrong_password')):
            attempts[stage] = 'rejected'
            private_save(host, record, folder)
            continue
        return snap, 'Account result unresolved; saved for inspection, no automatic retry'
    return snap, 'Account access could not be completed'
