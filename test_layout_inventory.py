"""Offline read-only mapping, access checkpoints and data-exclusion checks."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from playwright.sync_api import sync_playwright

from map_websites import (INSPECTOR, blueprint, choose_entry, export_index, form_structure,
                          inspect_site, mark_access_gap, mark_review, read_record, snapshot, write_record, WebsitePageError,
                          confirm_buttons)
from template_detector import detect, detect_forms
from mappings.common import NeedsAttention
from test_template_detector import FORM


class LayoutChecks(unittest.TestCase):
    def test_exact_completed_template_reuses_controls_but_changed_layout_asks(self):
        source_page = {'host': 'source.test', 'url': 'https://source.test/', 'forms': [],
                       'links': [{'label': 'Add Site', 'url': 'https://source.test/submit.php'}]}
        target = {'host': 'target.test', 'url': 'https://target.test/', 'forms': [],
                  'links': [{'label': 'Add Site', 'url': 'https://target.test/submit.php'}]}
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            write_record({'domain': 'source.test', 'pages': [source_page],
                          'completion_level': 'Final posting form reached; publication untested',
                          'button_confirmation': {'confirmed_by': 'operator', 'page': source_page['url'],
                                                  'controls': source_page['links']}}, folder)
            prompt, record = Mock(return_value='skip'), {}
            self.assertTrue(confirm_buttons('target.test', target, record, prompt, folder))
            prompt.assert_not_called()
            self.assertEqual(record['button_confirmation']['source_domain'], 'source.test')
            self.assertEqual(record['button_confirmation']['confirmed_by'], 'validated_template')
            target['links'][0]['url'] = 'https://target.test/changed-route'
            self.assertFalse(confirm_buttons('target.test', target, {}, prompt, folder))
            prompt.assert_called_once()

    def test_provisional_template_cannot_suppress_first_mapping_question(self):
        snap = {'host': 'source.test', 'url': 'https://source.test/', 'forms': [],
                'links': [{'label': 'Add Site', 'url': 'https://source.test/submit.php'}]}
        target = json.loads(json.dumps(snap).replace('source.test', 'target.test'))
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            write_record({'domain': 'source.test', 'pages': [snap],
                          'completion_level': 'Incomplete',
                          'button_confirmation': {'confirmed_by': 'operator', 'page': snap['url']}}, folder)
            prompt = Mock(return_value='skip')
            self.assertFalse(confirm_buttons('target.test', target, {}, prompt, folder))
            prompt.assert_called_once()

    def test_changed_previously_confirmed_layout_requires_new_confirmation(self):
        old = {'host': 'fixture.test', 'url': 'https://fixture.test/', 'access': 'Accessible',
               'forms': [], 'links': [{'label': 'Add Site', 'url': 'https://fixture.test/old'}]}
        changed = dict(old, links=[{'label': 'Add Site', 'url': 'https://fixture.test/new'}])
        with tempfile.TemporaryDirectory() as d, patch('map_websites.snapshot', return_value=changed):
            folder = Path(d)
            write_record({'domain': 'fixture.test', 'pages': [old],
                          'button_confirmation': {'confirmed_by': 'operator', 'page': old['url'], 'controls': old['links']}}, folder)
            prompt = Mock(return_value='skip')
            result = inspect_site(None, {'domain': 'fixture.test', 'website': old['url']}, folder, prompt)
            self.assertEqual(result['status'], 'Needs button confirmation')
            self.assertFalse(read_record('fixture.test', folder).get('button_confirmation'))
            prompt.assert_called_once()

    def test_alternate_route_cannot_start_account_flow_twice(self):
        login = {'host': 'fixture.test', 'url': 'https://fixture.test/login',
                 'access': 'Sign-in required', 'forms': [],
                 'links': [{'label': 'Register', 'url': 'https://fixture.test/register'}]}
        registration = dict(login, url='https://fixture.test/register', links=[])
        with tempfile.TemporaryDirectory() as d, \
             patch('map_websites.snapshot', side_effect=[login, registration]), \
             patch('site_access.automate_access', return_value=(login, 'Unresolved account result')) as access:
            with self.assertRaises(NeedsAttention):
                inspect_site(None, {'domain': 'fixture.test', 'website': login['url']},
                             Path(d), Mock(return_value='confirm'), credentials={'email': 'fixture'})
            access.assert_called_once()
            self.assertEqual(read_record('fixture.test', Path(d))['status'], 'Needs review')

    def test_access_gap_requires_route_evidence_and_explicit_confirmation(self):
        record = {'domain': 'fixture.test'}
        prompt = Mock(return_value='confirm access gap')
        with self.assertRaises(ValueError):
            mark_access_gap(record, prompt)
        prompt.assert_not_called()
        record['route_checks'] = {route: {'outcome': 'blocked', 'evidence': 'Observed explicit rejection on /' + route}
                                  for route in ('register', 'login', 'post')}
        mark_access_gap(record, Mock(return_value=''))
        self.assertEqual(record['status'], 'Needs review')
        mark_access_gap(record, prompt)
        self.assertEqual(record['status'], 'Access gap')

    def test_first_mapping_cannot_continue_without_button_confirmation(self):
        snap = {'host': 'fixture.test', 'url': 'https://fixture.test/', 'access': 'Accessible',
                'forms': [], 'links': [{'label': 'Add your business', 'url': 'https://fixture.test/add'}]}
        with tempfile.TemporaryDirectory() as d, patch('map_websites.snapshot', return_value=snap) as read:
            result = inspect_site(None, {'domain': 'fixture.test', 'website': 'https://fixture.test/'}, Path(d), Mock(return_value=''))
            self.assertEqual(result['status'], 'Needs button confirmation')
            self.assertNotIn('button_confirmation', result)
            self.assertEqual(read.call_count, 1)

    def test_authentication_limitation_still_follows_observed_posting_route(self):
        login = {'host': 'fixture.test', 'url': 'https://fixture.test/login', 'access': 'Sign-in required',
                 'forms': [], 'links': [{'label': 'Add Listing', 'url': 'https://fixture.test/add'}]}
        post = dict(login, url='https://fixture.test/add', access='Accessible', links=[],
                    native_present=True, forms=[detect(FORM)['signature']])
        with tempfile.TemporaryDirectory() as d, patch('map_websites.snapshot', side_effect=[login, post]) as read, \
             patch('site_access.automate_access', return_value=(login, 'Account form is not supported')), \
             patch('map_websites.native_check', return_value={'result': {'ok': True}}), \
             patch('map_websites.observe_browser'):
            result = inspect_site(None, {'domain': 'fixture.test', 'website': login['url']}, Path(d),
                                  Mock(return_value='confirm'), credentials={'email': 'not logged'})
            self.assertEqual(read.call_args_list[1].args[1], post['url'])
            self.assertEqual(result['completion_level'], 'Final posting form reached; publication untested')
            self.assertNotEqual(result['status'], 'Access gap')

    def test_new_inspection_preserves_independent_review_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            audit = {'conclusion': 'Observed login controls; signed-in access unconfirmed'}
            write_record({'domain': 'fixture.test', 'assistant_review': audit}, folder)
            write_record({'domain': 'fixture.test', 'status': 'Needs review'}, folder)
            self.assertEqual(read_record('fixture.test', folder)['assistant_review'], audit)

    def test_unsupported_form_is_unverified_review_not_confirmed_missing_information(self):
        r = {'domain': 'fixture.test', 'pages': [{'url': 'https://fixture.test/signup', 'forms': [{}]}]}
        mark_review(r, 'Account form is not supported by the current adapter; access has not been ruled out')
        self.assertEqual(r['status'], 'Needs review')
        self.assertEqual(r['review_reason'], 'Unsupported account form')
        self.assertEqual(r['review_evidence']['observed_form_count'], 1)
        self.assertIn('not independently confirmed', r['verification_level'])

    def test_suspension_after_browser_verification_skips_without_account_actions(self):
        waiting = {'host': 'fixture.test', 'url': 'https://fixture.test/', 'access': 'Browser verification', 'forms': [], 'links': []}
        restricted = dict(waiting, access='Accessible', account_restricted=True)
        with tempfile.TemporaryDirectory() as d, patch('map_websites.snapshot', side_effect=[waiting, restricted]), patch('map_websites.observe_browser') as observe:
            result = inspect_site(None, {'domain': 'fixture.test', 'website': 'https://fixture.test/'}, Path(d), Mock(return_value=''))
            self.assertEqual(result['status'], 'Skipped banned/suspended')
            observe.assert_not_called()

    def test_entry_navigation_prefers_posting_then_login_before_signup(self):
        snap = {'links': [{'label': 'Sign Up', 'url': 'https://fixture.test/signup'},
                          {'label': 'Log in', 'url': 'https://fixture.test/login'},
                          {'label': 'Add Listing', 'url': 'https://fixture.test/add'}]}
        self.assertEqual(choose_entry(snap, set()), 'https://fixture.test/add')
        self.assertEqual(choose_entry(snap, {'https://fixture.test/add'}), 'https://fixture.test/login')

    def test_collector_excludes_values_and_private_links_but_retains_controls(self):
        html = FORM + '''<a href="/submit.php">Submit</a><a href="/edit/private-token">Submit</a>
          <a href="/submit.php">ADD URL</a>
          <a href="https://other.test/register">Register</a><a href="/register?token=private">Register</a>
          <a href="/directory/listingedit.aspx">Add Listing</a>
          <a href="/directory/listingedit.aspx?id=private">Add Listing</a>
          <a href="/profile.php?mode=register&amp;agreed=true&amp;token=secret-token">Register</a>
          <form><input name="ctl00$Content$Email" value="private@example.test"></form>'''
        html += '<button id="register" type="button">Register</button><button aria-label="Add your business" type="button"></button>'
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.route('https://fixture.test/**', lambda route: route.fulfill(body=html, content_type='text/html'))
            page.goto('https://fixture.test/')
            result = page.evaluate(INSPECTOR)
            self.assertTrue(any(c['selector'] == '[id="register"]' and not c['navigation_only'] for c in result['controls']))
            self.assertTrue(any(c['label'] == 'Add your business' for c in result['controls']))
            self.assertTrue(any(c['label'] == 'ADD URL' and c['url'] == 'https://fixture.test/submit.php' and c['navigation_only'] for c in result['controls']))
            raw = json.dumps(result)
            self.assertNotIn('Private client', raw)
            self.assertNotIn('Private draft', raw)
            self.assertNotIn('secret-token', raw)
            self.assertNotIn('private-token', raw)
            self.assertNotIn('other.test', raw)
            self.assertNotIn('token=', raw)
            self.assertEqual({x['url'] for x in result['links']}, {'https://fixture.test/submit.php', 'https://fixture.test/register', 'https://fixture.test/directory/listingedit.aspx', 'https://fixture.test/profile.php?mode=register&agreed=true'})
            self.assertEqual(result['forms'][1]['fields'][0]['selector'], '[name="ctl00$Content$Email"]')
            self.assertNotIn('private@example.test', raw)
            self.assertEqual(detect_forms(form_structure(result)['forms'])['fingerprint'], detect(FORM)['fingerprint'])
            self.assertEqual(result['access'], 'Accessible')
            page.set_content('<form method="post"><input name="action" type="hidden" value="private"><input name="post_title"></form>')
            self.assertEqual(page.evaluate(INSPECTOR)['forms'][0]['action'], 'https://fixture.test/')
            page.set_content('<p>Your account has been suspended.</p>')
            self.assertTrue(page.evaluate(INSPECTOR)['account_restricted'])
            page.set_content('<p>Accounts may be suspended if terms are violated.</p>')
            self.assertFalse(page.evaluate(INSPECTOR)['account_restricted'])
            page.set_content('''<form action="/login.php" method="post"><input type="password" name="pass"></form>
                <h2>Step One Choose a Category:</h2><form action="/submit.php" method="post">
                <select name="CATEGORY_ID"><option>Sports</option></select>
                <input id="ok" type="button" value="Go To Step Two"></form>''')
            self.assertEqual(page.evaluate(INSPECTOR)['access'], 'Accessible')
            page.set_content('<form action="/login.php" method="post"><input type="password" name="pass"></form>')
            self.assertEqual(page.evaluate(INSPECTOR)['access'], 'Sign-in required')
            for title in ('509 Bandwidth Limit Exceeded', '508 Resource Limit Is Reached', '403 Forbidden', '404 Not Found', '500 Internal Server Error'):
                page.set_content('<title>' + title + '</title><p>Server error</p>')
                self.assertTrue(page.evaluate(INSPECTOR)['page_error'])
            page.set_content('<title>Submit Link</title><p>Warning: URL validator not registered</p>' + FORM)
            self.assertFalse(page.evaluate(INSPECTOR)['page_error'])
            page.set_content('<title>Just a moment</title><p>Verify you are human</p>')
            self.assertFalse(page.evaluate(INSPECTOR)['page_error'])
            browser.close()

    def test_access_wait_is_checkpointed_then_reads_current_page_without_reload(self):
        waiting = {'host': 'fixture.test', 'url': 'https://fixture.test/submit.php',
                   'access': 'Browser verification', 'forms': [], 'links': []}
        ready = dict(waiting, access='Accessible', forms=[detect(FORM)['signature']], native_present=True)
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            def done(message):
                if 'First mapping:' in message:
                    return 'confirm'
                self.assertEqual(read_record('fixture.test', folder)['status'], 'Access check required')
                return ''
            with patch('map_websites.snapshot', side_effect=[waiting, ready]) as read, \
                 patch('map_websites.native_check', return_value={'result': {'ok': True}}), \
                 patch('map_websites.observe_browser'):
                result = inspect_site(None, {'domain': 'fixture.test', 'website': 'https://fixture.test/'}, folder, done)
            self.assertEqual(read.call_args_list[1].args, (None,))
            self.assertEqual(result['status'], 'Form blueprint saved')
            self.assertEqual(result['field_map']['website'], '[name="URL"]')
            self.assertFalse(result['publishing_enabled_by_inventory'])
            self.assertEqual(result['runtime'], 'Needs adapter')

    def test_external_identity_check_is_skipped_without_recording_external_forms(self):
        external = {'host': 'accounts.google.com', 'access': 'Sign-in required', 'identity_check': True,
                    'forms': [{'private': 'Not retained'}]}
        with tempfile.TemporaryDirectory() as d, patch('map_websites.snapshot', return_value=external):
            prompt = Mock(side_effect=AssertionError('Do not retry identity verification'))
            result = inspect_site(None, {'domain': 'fixture.test', 'website': 'https://fixture.test/'}, Path(d), prompt)
            self.assertEqual(result['status'], 'Skipped identity verification')
            self.assertEqual(result['pages'], [])

    def test_index_includes_uninspected_sites_and_chunked_bridge_output_parses(self):
        with tempfile.TemporaryDirectory() as d:
            counts = export_index([{'domain': 'new.test'}], Path(d))
            self.assertEqual(counts['Not inspected'], 1)
            self.assertIn('new.test', (Path(d) / 'index.csv').read_text())
        client = Mock()
        client.call.return_value = {'content': [{'type': 'text', 'text': '[echo] LAYOUT_PART:0:{"host":\n[echo] LAYOUT_PART:8:"fixture.test"}'}]}
        self.assertEqual(snapshot(client)['host'], 'fixture.test')
        client.call.return_value = {'content': [{'type': 'text', 'text': '[echo] LAYOUT_PART:0:{"host":"fixture.test","url":"https://fixture.test/submit","page_error":"509 Bandwidth Limit Exceeded"}'}]}
        with self.assertRaises(WebsitePageError) as error:
            snapshot(client)
        self.assertEqual(error.exception.page['url'], 'https://fixture.test/submit')
        script = client.call.call_args.args[1]['script']
        self.assertNotIn('uiv.run("click"', script)
        self.assertNotIn('uiv.run("type"', script)


if __name__ == '__main__':
    unittest.main()
