"""New live-inspected directory forms replayed offline; no submissions or network."""
import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from playwright.sync_api import sync_playwright

from mappings.directories import DIRECTORY_INSPECTOR, LIVE_DIRECTORIES, submission_url
from mappings.playwright import prepare
from mappings.registry import DIRECTORIES
from mappings.discovery import directory_candidates
from backlinks import recover_directory


class LiveDirectoryChecks(unittest.TestCase):
    def test_search_selects_only_matching_destination_and_journals_before_verification(self):
        business = {'name': 'Example Sports', 'website': 'https://business.example/st-louis/'}
        html = '''<table>
          <tr><td><a id="id_1" href="https://business.example/omaha/">Example Sports</a><a href="/Omaha_1.html">Details</a></td></tr>
          <tr><td><a id="id_2" href="https://business.example/st-louis/">Example Sports</a><a href="/St-Louis_2.html">Details</a><a href="https://other.example/St-Louis_2.html">Other</a></td></tr>
          <tr><td><a id="id_3" href="https://business.example/st-louis/">Example Sports</a><a href="/St-Louis_3.html">Details</a><a href="/St-Louis_3.html?token=private">Edit</a></td></tr>
          <tr><td><a id="4" href="https://business.example/st-louis/">Example Sports</a></td></tr>
        </table>'''
        calls = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            class FixtureBrowser:
                def new_context(self):
                    ctx = browser.new_context()
                    def intercept(route):
                        calls.append(route.request.method)
                        route.fulfill(content_type='text/html', body=html)
                    ctx.route('https://fixture.test/**', intercept)
                    return ctx
            urls = directory_candidates(FixtureBrowser(), business, 'fixture.test')
            self.assertEqual(urls, ['https://fixture.test/Example-Sports_4.html', 'https://fixture.test/St-Louis_3.html', 'https://fixture.test/St-Louis_2.html'])
            self.assertEqual(calls, ['GET'])
            browser.close()
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            state = {'fixture.test': {'status': 'pending'}}
            def verified(browser, url, b, host):
                journal = json.loads((folder / 'state.json').read_text())
                self.assertEqual(journal[host]['candidate_url'], urls[0])
                return {'status': 'published', 'url': url, 'reason': 'Public page verified'}
            with patch('backlinks.directory_candidates', return_value=urls), patch('backlinks.verify', side_effect=verified):
                self.assertTrue(recover_directory(None, business, 'fixture.test', state, folder,
                                                 [{'row': '', 'domain': 'fixture.test'}], 'new'))
            self.assertEqual(state['fixture.test']['status'], 'published')
            self.assertEqual(state['fixture.test']['listing_origin'], 'new')

    def test_recorded_native_forms_fill_public_content_and_refuse_changed_submit(self):
        business = {'name': 'Example Sports', 'website': 'https://business.example/location/',
                    'description': 'Approved sports instruction.', 'category': 'Sports',
                    'email': 'public@example.com', 'phone': '+1 012 345 6789',
                    'hours': 'Monday: 15:00-21:00', 'keywords': 'sports, classes'}
        self.assertTrue(LIVE_DIRECTORIES.keys() <= DIRECTORIES)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for host, site in LIVE_DIRECTORIES.items():
                with self.subTest(host=host):
                    page = browser.new_page()
                    html = Path(site['fixture']).read_text(encoding='utf-8')
                    calls = []
                    def intercept(route):
                        calls.append(route.request.method)
                        route.fulfill(content_type='text/html', body=html,
                                      headers={'content-security-policy': "default-src 'none'; script-src 'unsafe-eval'"})
                    page.route('**/*', intercept)
                    record = {}
                    with patch('mappings.playwright.wait_for_challenge'):
                        selector, candidate = prepare(page, host, business, {}, record, False)
                    self.assertEqual(selector, '[name="submit"][type="submit"]')
                    self.assertIsNone(candidate)
                    self.assertEqual(page.locator('[name="URL"]').input_value(), business['website'])
                    body = page.locator('[name="DESCRIPTION"]').input_value()
                    self.assertIn(business['website'], body)
                    self.assertIn(business['phone'], body)
                    self.assertIn(business['hours'], body)
                    self.assertIn(business['keywords'], body)
                    self.assertEqual(page.evaluate(DIRECTORY_INSPECTOR, site), {'ok': True, 'freeSelected': True})
                    if site.get('manualRadio', {}).get('otherValues'):
                        radio = site['manualRadio']
                        alternative = page.locator('[name="' + radio['name'] + '"][value="' + radio['otherValues'][0] + '"]')
                        alternative.check()
                        self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['freeSelected'])
                        alternative.evaluate('(e)=>e.value="unexpected-paid-plan"')
                        self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                        page.locator('[name="' + radio['name'] + '"][value="unexpected-paid-plan"]').evaluate('(e,v)=>e.value=v', radio['otherValues'][0])
                        selected = page.locator('[name="' + radio['name'] + '"][value="' + radio['value'] + '"]')
                        selected.check()
                        selected.evaluate('(e)=>e.closest("tr").querySelector("td.price").textContent="$10"')
                        self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                        selected.evaluate('(e)=>e.closest("tr").querySelector("td.price").textContent="free"')
                    if site.get('optionalReciprocal'):
                        reciprocal = page.locator('[name="RECPR_URL"]')
                        self.assertEqual(reciprocal.input_value(), '')
                        reciprocal.evaluate('(e)=>e.required=true')
                        self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                        reciprocal.evaluate('(e)=>e.required=false')
                    page.locator('[name="submit"]').evaluate('(e)=>e.value="Pay Now"')
                    self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                    page.locator('[name="submit"]').evaluate('(e)=>e.value="Continue"')
                    page.locator('[name="TITLE"]').evaluate('(e)=>e.form.action="https://other.example/submit.php"')
                    self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                    self.assertTrue(all(method == 'GET' for method in calls))
                    page.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
