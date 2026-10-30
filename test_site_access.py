"""Offline shared-account access contracts, verification and registration protection."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from site_access import AUTH_FLAGS_JS, automate_access, contract, private_load, private_save, shared_credentials, submit_account


CREDS = {'username': 'supplied-user', 'email': 'private@example.test', 'password': 'private-password'}


def page(register=False):
    names = ['usr', 'email', 'pass', 'ckb', 'signup'] if register else ['usr', 'pass', 'login']
    return {'host': 'fixture.test', 'url': 'https://fixture.test/' + ('signup' if register else 'login'),
            'access': 'Sign-in required', 'links': [{'label': 'Sign up', 'url': 'https://fixture.test/signup'}],
            'forms': [{'method': 'post', 'action': 'https://fixture.test/' + ('signup' if register else 'login'),
                       'fields': [{'name': n, 'visible': True, 'selector': '[name="' + n + '"]',
                                   'required': False, 'type': 'submit' if n in ('login','signup') else 'password' if n == 'pass' else 'checkbox' if n == 'ckb' else 'text'} for n in names]}]}


class AccessChecks(unittest.TestCase):
    def setUp(self):
        self.wait = patch('site_access.time.sleep')
        self.wait.start()
        self.addCleanup(self.wait.stop)

    def test_uncertain_login_stops_without_registration_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as d, patch('site_access.auth_flags', return_value={}), \
             patch('site_access.submit_account') as action:
            read = Mock(return_value=page())
            for _ in range(2):
                _, reason = automate_access(None, 'fixture.test', page(), CREDS, read, folder=Path(d))
                self.assertTrue(reason)
            self.assertEqual(sum(c.kwargs.get('click', True) for c in action.call_args_list), 1)
            self.assertEqual(private_load('fixture.test', Path(d))['account_attempts']['login'], 'uncertain')

    def test_captcha_error_after_click_never_causes_second_login(self):
        with tempfile.TemporaryDirectory() as d, \
             patch('site_access.auth_flags', side_effect=[{}, {}, {}, {'captcha': True, 'standard_captcha': True}]), \
             patch('site_access.submit_account') as action:
            prompt = Mock()
            _, reason = automate_access(None, 'fixture.test', page(), CREDS,
                                       Mock(return_value=page()), prompt, Path(d))
            self.assertIn('no automatic retry', reason)
            self.assertEqual(sum(c.kwargs.get('click', True) for c in action.call_args_list), 1)
            prompt.assert_not_called()

    def test_click_exception_preserves_uncertain_login_and_blocks_replay(self):
        with tempfile.TemporaryDirectory() as d, patch('site_access.auth_flags', return_value={}):
            def action(*args, click=True, **kwargs):
                if click:
                    raise RuntimeError('Connection lost after click')
            with patch('site_access.submit_account', side_effect=action):
                with self.assertRaises(RuntimeError):
                    automate_access(None, 'fixture.test', page(), CREDS, Mock(return_value=page()), folder=Path(d))
            with patch('site_access.submit_account') as repeated:
                automate_access(None, 'fixture.test', page(), CREDS, Mock(), folder=Path(d))
                repeated.assert_not_called()

    def test_explicit_login_rejection_uses_saved_signup_route_without_repeating_login(self):
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            private_save('fixture.test', {'account_attempts': {'login': 'rejected'},
                                        'registration_url': 'https://fixture.test/signup'}, folder)
            login = dict(page(), links=[])
            ready = {'host': 'fixture.test', 'access': 'Accessible'}
            read = Mock(side_effect=[page(True), page(True), ready])
            with patch('site_access.auth_flags', side_effect=[{}, {}, {}, {'authenticated_navigation': True}]), \
                 patch('site_access.submit_account') as action:
                _, reason = automate_access(None, 'fixture.test', login, CREDS, read, folder=folder)
                self.assertFalse(reason)
                self.assertEqual(sum(c.kwargs.get('click', True) for c in action.call_args_list), 1)
                self.assertTrue(all(c.args[1]['url'].endswith('/signup') for c in action.call_args_list))

    def test_taken_blog_names_try_three_variants_without_another_login(self):
        with tempfile.TemporaryDirectory() as d:
            creds = dict(CREDS, blog_name='BusinessName')
            current = page()
            real_contract = contract
            def read(client, url=None):
                nonlocal current
                if url:
                    current = page(url.endswith('/signup'))
                return current
            def spec(snap, registering=False):
                result = real_contract(snap, registering)
                if registering:
                    result['values']['[name="usr"]'] = 'blog_name'
                return result
            flags = [{}, {}, {}, {'invalid_login': True}]
            flags += [{}, {}, {'registration_rejected': True, 'username_exists': True}] * 4
            with patch('site_access.auth_flags', side_effect=flags), patch('site_access.contract', side_effect=spec), \
                 patch('site_access.submit_account') as action:
                _, reason = automate_access(None, 'fixture.test', page(), creds, read, folder=Path(d))
            self.assertIn('Three modified', reason)
            clicks = [c for c in action.call_args_list if c.kwargs.get('click', True)]
            self.assertEqual(len(clicks), 5)  # One login; base registration plus three distinct names.
            self.assertEqual([c.args[3]['blog_name'] for c in clicks[1:]],
                             ['BusinessName', 'BusinessNameA', 'BusinessNameB', 'BusinessNameC'])
            with patch('site_access.auth_flags', return_value={}), patch('site_access.submit_account') as replay:
                automate_access(None, 'fixture.test', page(), creds, read, folder=Path(d))
                replay.assert_not_called()

    def test_registered_email_skips_even_when_username_also_exists(self):
        with tempfile.TemporaryDirectory() as d:
            flags = [{}, {}, {}, {'invalid_login': True}, {}, {},
                     {'registration_rejected': True, 'username_exists': True, 'email_exists': True}]
            with patch('site_access.auth_flags', side_effect=flags), patch('site_access.submit_account') as action:
                _, reason = automate_access(None, 'fixture.test', page(), CREDS,
                    Mock(side_effect=[page(), page(), page(True), page(True), page(True)]), folder=Path(d))
                self.assertIn('Email already registered', reason)
                self.assertEqual(sum(c.kwargs.get('click', True) for c in action.call_args_list), 2)
            with patch('site_access.auth_flags') as flags, patch('site_access.submit_account') as replay:
                automate_access(None, 'fixture.test', page(), CREDS, Mock(), folder=Path(d))
                replay.assert_not_called()
                flags.assert_not_called()

    def test_delayed_signin_is_resolved_by_readonly_inspection(self):
        with tempfile.TemporaryDirectory() as d:
            ready = {'host': 'fixture.test', 'access': 'Accessible'}
            with patch('site_access.auth_flags', side_effect=[{}, {}, {}, {}, {}, {}, {'authenticated_navigation': True}]), \
                 patch('site_access.submit_account') as action:
                _, reason = automate_access(None, 'fixture.test', page(), CREDS,
                    Mock(side_effect=[page(), page(), page(), page(), ready]), folder=Path(d))
            self.assertFalse(reason)
            self.assertEqual(sum(c.kwargs.get('click', True) for c in action.call_args_list), 1)
            self.assertIn('read-only', private_load('fixture.test', Path(d))['validated_inspection_rule'])

    def test_legacy_login_checkpoint_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as d, patch('site_access.auth_flags', return_value={}), \
             patch('site_access.submit_account') as action:
            private_save('fixture.test', {'stage': 'login', 'checked_utc': 'saved'}, Path(d))
            automate_access(None, 'fixture.test', page(), CREDS, Mock(), folder=Path(d))
            action.assert_not_called()

    def test_short_suspension_and_invalid_login_messages_are_recognized(self):
        from playwright.sync_api import sync_playwright
        from map_websites import INSPECTOR
        with sync_playwright() as p:
            browser = p.chromium.launch()
            tab = browser.new_page()
            tab.set_content('<p>Account temporarily suspended Contact</p>')
            self.assertTrue(tab.evaluate('() => {' + AUTH_FLAGS_JS + '}')['account_restricted'])
            self.assertTrue(tab.evaluate(INSPECTOR)['account_restricted'])
            tab.set_content('<p>Your site has been suspended for violating our Terms of Service</p>')
            self.assertTrue(tab.evaluate('() => {' + AUTH_FLAGS_JS + '}')['account_restricted'])
            self.assertTrue(tab.evaluate(INSPECTOR)['account_restricted'])
            tab.set_content('<p>Your blog has been suspended by our moderators</p>')
            self.assertTrue(tab.evaluate('() => {' + AUTH_FLAGS_JS + '}')['account_restricted'])
            self.assertTrue(tab.evaluate(INSPECTOR)['account_restricted'])
            tab.set_content('<p>You have entered an invalid login. Please try logging in again.</p>')
            self.assertTrue(tab.evaluate('() => {' + AUTH_FLAGS_JS + '}')['invalid_login'])
            tab.set_content('<p>Email address is already registered</p>')
            self.assertTrue(tab.evaluate('() => {' + AUTH_FLAGS_JS + '}')['email_exists'])
            tab.set_content('<p>Username already exists</p>')
            flags = tab.evaluate('() => {' + AUTH_FLAGS_JS + '}')
            self.assertTrue(flags['username_exists'])
            self.assertFalse(flags['email_exists'])
            browser.close()

    def test_blog_name_uses_business_name_without_spaces_or_punctuation(self):
        with patch('backlinks.load_workbook', return_value=(
                {'name': 'Cheer Athletics-St. Louis'},
                [{'username': 'supplied-user', 'login_email': 'private@example.test', 'password': 'private-password'}])):
            self.assertEqual(shared_credentials('fixture.xlsx')['blog_name'], 'CheerAthleticsStLouis')

    def test_bleepblogs_registration_maps_blog_name_despite_email_input_type(self):
        snap = page(True)
        snap['host'] = 'bleepblogs.com'
        snap['forms'][0]['action'] = 'https://bleepblogs.com/register'
        fields = snap['forms'][0]['fields']
        fields[0].update(name='username', selector='[name="username"]', type='email', label='blog name')
        fields[1].update(type='email', label='your email')
        fields[2].update(name='password', selector='[name="password"]', label='password')
        spec = contract(snap, True)
        self.assertEqual(spec['values']['[name="username"]'], 'blog_name')
        self.assertEqual(spec['values']['[name="email"]'], 'email')
        snap['host'] = 'blog-gold.com'
        snap['forms'][0]['action'] = 'https://blog-gold.com/register'
        self.assertEqual(contract(snap, True)['values']['[name="username"]'], 'blog_name')
        snap['host'] = 'blog2freedom.com'
        snap['forms'][0]['action'] = 'https://blog2freedom.com/register'
        self.assertEqual(contract(snap, True)['values']['[name="username"]'], 'blog_name')
        snap['host'] = 'new-matching.test'
        snap['forms'][0]['action'] = 'https://new-matching.test/register'
        self.assertEqual(contract(snap, True)['values']['[name="username"]'], 'blog_name')
        fields[0]['label'] = 'full legal name'
        self.assertIsNone(contract(snap, True))
        fields[0]['label'] = 'blog name'
        fields[0]['type'] = 'text'
        self.assertIsNone(contract(snap, True))
        fields[0]['type'] = 'email'
        snap['forms'][0]['action'] = 'https://fixture.test/purchase'
        self.assertIsNone(contract(snap, True))

    def test_visible_keycaptcha_blocks_even_without_iframe_or_validation_error(self):
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content('<form><div id="KEY-Captcha"><div id="logo_key_captcha">Verification puzzle</div></div></form>')
            flags = page.evaluate('() => {' + AUTH_FLAGS_JS + '}')
            self.assertTrue(flags['captcha'])
            self.assertTrue(flags['custom_captcha'])
            self.assertFalse(flags['standard_captcha'])
            page.locator('#KEY-Captcha').evaluate('(e)=>e.remove()')
            self.assertFalse(page.evaluate('() => {' + AUTH_FLAGS_JS + '}')['captcha'])
            browser.close()

    def test_live_label_collection_recognizes_new_hostname_without_saving_field_values(self):
        from playwright.sync_api import sync_playwright
        from map_websites import INSPECTOR
        fixture = '''<form method="post"><label for="blog">Blog Name</label>
          <input id="blog" name="username" type="email" required>
          <label for="email">Your Email</label><input id="email" name="email" type="email" required>
          <label for="password">Password</label><input id="password" name="password" type="password" value="private-fixture-secret" required>
          <button name="signup" type="submit">Sign up</button></form>'''
        with sync_playwright() as p:
            browser = p.chromium.launch()
            tab = browser.new_page()
            tab.route('https://new-matching.test/register', lambda route: route.fulfill(body=fixture, content_type='text/html'))
            tab.goto('https://new-matching.test/register')
            snap = tab.evaluate(INSPECTOR)
            self.assertEqual(contract(snap, True)['values']['[name="username"]'], 'blog_name')
            self.assertNotIn('private-fixture-secret', json.dumps(snap))
            tab.locator('label[for="blog"]').evaluate('(e)=>e.textContent="Full legal name"')
            self.assertIsNone(contract(tab.evaluate(INSPECTOR), True))
            browser.close()

    def test_signup_blog_address_uses_business_name_only_with_observed_purpose(self):
        snap = page(True)
        form = snap['forms'][0]
        form['account_family'] = 'blog-address-signup'
        form['fields'][0].update(name='username', selector='[name="username"]')
        form['fields'][1]['type'] = 'email'
        form['fields'][2].update(name='password', selector='[name="password"]')
        self.assertEqual(contract(snap, True)['values']['[name="username"]'], 'blog_name')
        form['account_family'] = ''
        self.assertIsNone(contract(snap, True))

    def test_blog_username_password_login_contract(self):
        snap = page()
        fields = snap['forms'][0]['fields']
        fields[0].update(name='username', selector='[name="username"]')
        fields[1].update(name='password', selector='[name="password"]')
        spec = contract(snap)
        self.assertEqual(spec['values'], {'[name="username"]': 'username', '[name="password"]': 'password'})
        snap['forms'][0]['action'] = 'https://fixture.test/sign-in'
        fields[0]['type'] = 'email'
        self.assertEqual(contract(snap)['values']['[name="username"]'], 'email')
        fields[1]['type'] = 'text'
        self.assertIsNone(contract(snap))
        fields[1]['type'] = 'password'
        snap['forms'][0]['action'] = 'https://fixture.test/purchase'
        self.assertIsNone(contract(snap))

    def test_php_registration_maps_supplied_fields_and_leaves_captcha_to_operator(self):
        snap = {'host':'fixture.test','forms':[{'method':'post','action':'https://fixture.test/user/register',
                'fields':[{'name':n,'visible':True,'selector':'[name="'+n+'"]','required':True,
                           'type':'submit' if n=='send' else 'password' if n in ('PASSWORD','PASSWORDC') else 'text'}
                          for n in ('LOGIN','EMAIL','PASSWORD','PASSWORDC','CAPTCHA','send')]}]}
        spec = contract(snap, True)
        self.assertEqual(spec['values']['[name="PASSWORDC"]'], 'password')
        self.assertNotIn('[name="CAPTCHA"]', spec['values'])
        snap['forms'][0]['action'] = 'https://fixture.test/profile.php'
        snap['forms'][0]['fields'].append({'name':'NAME','selector':'[name="NAME"]',
                                          'type':'text','required':True,'visible':True})
        self.assertEqual(contract(snap, True)['values']['[name="NAME"]'], 'business_name')
        snap['forms'][0]['fields'].append({'name':'personal_name','visible':True,'required':True})
        self.assertIsNone(contract(snap, True))

    def test_php_directory_login_requires_inspected_action_and_password_control(self):
        snap = page()
        fields = snap['forms'][0]['fields']
        fields[0].update(name='user', selector='[name="user"]')
        fields[2].update(name='submit', selector='[name="submit"]')
        fields.append({'name':'rememberMe', 'selector':'[name="rememberMe"]',
                       'type':'checkbox', 'required':False, 'visible':True})
        spec = contract(snap)
        self.assertEqual(spec['values']['[name="user"]'], 'username')
        self.assertEqual(spec['uncheck'], '[name="rememberMe"]')
        snap['forms'][0]['action'] = 'https://fixture.test/login.php'
        fields[2].update(name='login', selector='[name="login"]')
        self.assertEqual(contract(snap)['submit'], '[name="login"]')
        snap['forms'][0]['action'] = 'https://fixture.test/purchase'
        self.assertIsNone(contract(snap))
        snap['forms'][0]['action'] = 'https://fixture.test/login'
        fields[2].update(name='submit', selector='[name="submit"]')
        fields[1]['type'] = 'text'
        self.assertIsNone(contract(snap))

    def test_banned_account_stops_before_registration_and_remains_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            with patch('site_access.auth_flags', side_effect=[{}, {}, {}, {'account_restricted': True}]), patch('site_access.submit_account') as submit:
                _, reason = automate_access(None, 'fixture.test', page(), CREDS, Mock(return_value=page()), folder=folder)
                self.assertIn('Banned or suspended', reason)
                self.assertEqual(sum(call.kwargs.get('click', True) for call in submit.call_args_list), 1)
            self.assertEqual(private_load('fixture.test', folder)['status'], 'skipped_restricted_account')
            with patch('site_access.submit_account') as submit:
                automate_access(None, 'fixture.test', page(), CREDS, Mock(), folder=folder)
                submit.assert_not_called()

    def test_contracts_require_same_site_and_refuse_missing_required_information(self):
        spec = contract(page(True), True)
        self.assertEqual(spec['values']['[name="usr"]'], 'username')
        self.assertEqual(spec['uncheck'], '[name="ckb"]')
        changed = page(True)
        changed['forms'][0]['fields'].append({'name': 'personal_first_name', 'required': True, 'visible': True})
        self.assertIsNone(contract(changed, True))
        changed = page()
        changed['forms'][0]['action'] = 'https://elsewhere.test/login'
        self.assertIsNone(contract(changed))

    def test_registration_is_journaled_before_click_and_never_stores_credentials(self):
        login, signup = page(), page(True)
        ready = {'host': 'fixture.test', 'access': 'Accessible'}
        read = Mock(side_effect=[login, login, signup, signup, ready])
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            def submit(client, snap, spec, creds, click=True, fill=True):
                if click and snap['url'].endswith('/signup'):
                    self.assertEqual(private_load('fixture.test', folder)['registration'], 'submitting')
            with patch('site_access.auth_flags', side_effect=[{}, {}, {}, {'invalid_login': True}, {}, {}, {'authenticated_navigation': True}]), patch('site_access.submit_account', side_effect=submit) as clicked:
                result, reason = automate_access(None, 'fixture.test', login, CREDS, read, folder=folder)
            self.assertFalse(reason)
            self.assertEqual(sum(call.kwargs.get('click', True) for call in clicked.call_args_list), 2)
            self.assertEqual(private_load('fixture.test', folder)['registration'], 'completed')
            saved = (folder / 'fixture.test.json').read_text()
            self.assertNotIn(CREDS['email'], saved)
            self.assertNotIn(CREDS['password'], saved)

    def test_uncertain_registration_is_not_automatically_repeated(self):
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            private_save('fixture.test', {'registration': 'submitting'}, folder)
            with patch('site_access.submit_account') as submit, patch('site_access.auth_flags', return_value={}):
                _, reason = automate_access(None, 'fixture.test', page(), CREDS, Mock(return_value=page()), folder=folder)
                self.assertIn('protected', reason)
                submit.assert_not_called()

    def test_captcha_requires_operator_before_any_account_submission(self):
        with tempfile.TemporaryDirectory() as d:
            with patch('site_access.auth_flags', return_value={'captcha': True}), patch('site_access.submit_account') as submit:
                prompt = Mock(return_value='skip')
                _, reason = automate_access(None, 'fixture.test', page(), CREDS, Mock(), prompt, Path(d))
                self.assertIn('CAPTCHA', reason)
                submit.assert_called_once()
                self.assertFalse(submit.call_args.kwargs['click'])
                prompt.assert_called_once()

    def test_raw_credential_logs_are_never_printed(self):
        client = Mock()
        client.call.return_value = {'content': [{'type': 'text', 'text': CREDS['password']}]}
        with patch('builtins.print') as output:
            submit_account(client, page(), contract(page()), CREDS)
            output.assert_not_called()
        script = client.call.call_args.args[1]['script']
        self.assertIn('Account form changed', script)

    def test_completed_captcha_is_not_reset_by_refilling_credentials(self):
        with tempfile.TemporaryDirectory() as d:
            ready = {'host': 'fixture.test', 'access': 'Accessible'}
            with patch('site_access.auth_flags', side_effect=[{}, {'captcha': True}, {}, {'authenticated_navigation': True}]), patch('site_access.submit_account') as action:
                _, reason = automate_access(None, 'fixture.test', page(), CREDS,
                    Mock(side_effect=[page(), page(), ready]), Mock(return_value=''), Path(d))
                self.assertFalse(reason)
                self.assertFalse(action.call_args_list[0].kwargs['click'])
                self.assertFalse(action.call_args_list[1].kwargs['fill'])

    def test_guest_homepage_does_not_count_as_confirmed_signin(self):
        with tempfile.TemporaryDirectory() as d:
            guest = {'host': 'fixture.test', 'access': 'Accessible', 'links': []}
            with patch('site_access.auth_flags', return_value={}), patch('site_access.submit_account'):
                _, reason = automate_access(None, 'fixture.test', page(), CREDS,
                    Mock(side_effect=[page(), *[guest] * 25]), folder=Path(d))
            self.assertTrue(reason)
            self.assertNotEqual(private_load('fixture.test', Path(d)).get('status'), 'signed_in')


if __name__ == '__main__':
    unittest.main()
