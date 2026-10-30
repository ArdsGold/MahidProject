"""Category/editor fixtures and receipt recovery; no live network or publishing."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from playwright.sync_api import sync_playwright

from mappings.categories import category_choice
from mappings.common import NeedsAttention
from mappings.editors import article_html, fill_rich_editor
from uivision_publish import run_queue
from backlinks import prepare


BUSINESS = {'name': 'Example Gym', 'website': 'https://business.example/',
            'description': 'First approved line.\nSecond line.\n\nLast paragraph <literal>.', 'category': 'Sports'}


class ReusedFeaturesChecks(unittest.TestCase):
    def test_writeablog_prepares_existing_public_blog_and_protects_saved_drafts(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            requests = []
            saved_draft = False
            def fixture(route):
                requests.append(route.request.method)
                if route.request.url.endswith('/login'):
                    body = '''<input id="username-input"><input id="password-input" type="password">
                    <button id="btn-login" onclick="location.href='/dashboard'">Sign in</button>'''
                else:
                    body = '''<textarea id="writer">DRAFT</textarea><button id="publish-to">Draft</button>
                    <a href="#exampleblog" onclick="window.blogTarget='exampleblog';return false">Public blog</a>
                    <button id="publish">Publish</button><script>window.blogTarget='anonymous';
                    window.H={get:()=>window.blogTarget};window.publishing=false;</script>'''.replace('DRAFT', 'Saved work' if saved_draft else '')
                route.fulfill(content_type='text/html', body=body)
            page.route('https://writeablog.net/**', fixture)
            entry = {'username': 'exampleblog', 'password': 'fixture-only'}
            selector, candidate = prepare(page, 'writeablog.net', BUSINESS, entry, {}, False)
            self.assertEqual(selector, '#publish')
            self.assertIsNone(candidate)
            self.assertIn(BUSINESS['website'], page.locator('#writer').input_value())
            self.assertEqual(page.evaluate("H.get('postTarget')"), 'exampleblog')
            self.assertTrue(all(method == 'GET' for method in requests))
            saved_draft = True
            with self.assertRaisesRegex(NeedsAttention, 'Existing editor draft'):
                prepare(page, 'writeablog.net', BUSINESS, entry, {}, False)
            browser.close()

    def test_category_matches_actual_options_and_refuses_ambiguous_or_unrelated_choices(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            options = [{'label': '|___Animal Sports', 'value': 'animal'}, {'label': '|___Sports', 'value': 'sports'}]
            self.assertEqual(category_choice(page, options, BUSINESS)['value'], 'sports')
            self.assertIsNone(category_choice(page, options[:1], BUSINESS))
            nested = [{'label': '| |___Sports', 'value': 'nested'}, options[1]]
            self.assertEqual(category_choice(page, nested, BUSINESS)['value'], 'sports')
            self.assertIsNone(category_choice(page, [options[1], {**options[1], 'value': 'second'}], BUSINESS))
            self.assertIsNone(category_choice(page, [{**options[1], 'disabled': True}], BUSINESS))
            roofing = {'category': 'Roofing Contractors', 'description': 'Residential roof repair', 'services': 'Roofing'}
            options = [{'label': 'Roofing', 'value': 'roof'}, {'label': 'Restaurants', 'value': 'food'}]
            self.assertEqual(category_choice(page, options, roofing)['value'], 'roof')
            self.assertIsNone(category_choice(page, [options[1]], roofing))
            self.assertIsNone(category_choice(page, [{'label': 'Choose a category', 'value': ''}], roofing))
            browser.close()

    def test_rich_editor_preserves_approved_paragraphs_links_and_synchronizes_backing_field(self):
        value = article_html(BUSINESS)
        self.assertIn('<br>Second line.', value)
        self.assertIn('&lt;literal&gt;', value)
        self.assertNotIn('<literal>', value)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content('<textarea id="article" hidden></textarea>')
            page.evaluate('''() => {
              let content = '';
              window.tinymce = {get: id => id === 'article' ? {
                setContent: value => content = value, getContent: () => content, fire() {},
                save: () => document.querySelector('#article').value = content
              } : null};
            }''')
            fill_rich_editor(page, '#article', value)
            self.assertEqual(page.locator('#article').input_value(), value)
            page.evaluate('''() => {
              delete window.tinymce;
              let content = '';
              window.CKEDITOR = {instances: {article: {
                setData(value, options) { setTimeout(() => {content = value; options.callback();}, 10); },
                getData: () => content, updateElement: () => document.querySelector('#article').value = content, fire() {}
              }}};
            }''')
            fill_rich_editor(page, '#article', value)
            self.assertEqual(page.locator('#article').input_value(), value)
            page.evaluate("() => {delete window.CKEDITOR; window.tinymce = {get: () => ({setContent() {}, getContent: () => '<p>Lost link</p>', fire() {}, save() {}})};}")
            with self.assertRaisesRegex(NeedsAttention, 'retain'):
                fill_rich_editor(page, '#article', value)
            browser.close()

    def test_saved_candidate_recovery_never_calls_browser_submission(self):
        host = 'smartdir.org'
        candidate = 'https://smartdir.org/details.php?id=42'
        entries = [{'row': 1, 'domain': host}]
        for succeeds in (True, False):
            with self.subTest(verified=succeeds), tempfile.TemporaryDirectory() as d:
                folder = Path(d)
                state = {host: {'status': 'unverified', 'candidate_url': candidate, 'submission_id': 'old-attempt'}}
                verified = {'status': 'published', 'url': candidate, 'reason': 'Public page verified'}
                with patch('uivision_publish.verify', return_value=verified,
                           side_effect=None if succeeds else NeedsAttention('Not public yet')) as verify, \
                     patch('uivision_publish.run_stage', return_value={'status': 'uncertain'}) as submit:
                    if succeeds:
                        run_queue(None, None, BUSINESS, entries, state, folder)
                        submit.assert_not_called()
                    else:
                        with self.assertRaises(NeedsAttention):
                            run_queue(None, None, BUSINESS, entries, state, folder)
                        self.assertEqual([c.args[2] for c in submit.call_args_list], ['receipt'])
                    verify.assert_any_call(None, candidate, BUSINESS, host)
                saved = json.loads((folder / 'state.json').read_text())
                self.assertEqual(saved[host]['submission_id'], 'old-attempt')
                self.assertEqual(saved[host]['candidate_url'], candidate)
                self.assertEqual(saved[host]['status'], 'published' if succeeds else 'unverified')
                urls = (folder / 'published_urls.txt').read_text()
                self.assertEqual(urls, candidate + '\n' if succeeds else '')


if __name__ == '__main__':
    unittest.main()
