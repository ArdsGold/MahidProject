"""Imported source fixtures, intercepted locally; no live pages or submissions."""
import csv
import hashlib
import json
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

from playwright.sync_api import sync_playwright

from backlinks import prepare
from mappings.directories import DIRECTORY_INSPECTOR, DIRECTORY_SITES, IMPORTED_DIRECTORIES, LIVE_DIRECTORIES, submission_url
from mappings.common import CONTENT_FITTER
from mappings.categories import CATEGORY_MATCHER
from mappings.registry import DIRECTORIES, SUPPORTED
from uivision_publish import SCRIPT, make_job

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / 'extSource/source/extension/test/family3/fixtures'
BUSINESS = {'name': 'Example Gym', 'description': 'Approved sports description',
            'website': 'https://business.example/', 'email': 'public@example.com', 'category': 'Sports'}


def fixture_file(host, site):
    special = {'ad-links.org': 'ad-links.org', 'backpagedir.com': 'backpagedir.com',
               'addgoodsites.com': 'addgoodsites.com', 'businessfreedirectory.biz': 'businessfreedirectory.biz',
               'adbritedirectory.com': 'adbritedirectory.com', 'jet-links.com': 'jet-links.com',
               'efdir.com': 'efdir-http', 'smartdir.org': 'smartdir-https',
               'toptendir.net': 'toptendir-https', 'relevantdirectories.com': 'relevant-directories-https', 'relevantdirectory.biz': 'relevant-directory-https'}
    return FIXTURES / (special.get(host, site['id']) + '.html')


def serve(page, html):
    methods = []
    def intercept(route):
        methods.append(route.request.method)
        route.fulfill(content_type='text/html', body=html,
                      headers={'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-eval'"})
    page.route('**/*', intercept)
    return methods


class ImportedMappingsChecks(unittest.TestCase):
    def test_live_lemon_contract_supports_plain_table_labels(self):
        site = DIRECTORY_SITES['lemon-directory.com']
        self.assertEqual(make_job(BUSINESS, 'lemon-directory.com')['directory'], site)
        html = '''<form method="post"><table>
        <tr><td>*Title:</td><td><input name="TITLE"></td></tr>
        <tr><td>*URL:</td><td><input name="URL"></td></tr>
        <tr><td>Description:</td><td><textarea name="DESCRIPTION"></textarea></td></tr>
        <tr><td>*Your Name:</td><td><input name="OWNER_NAME"></td></tr>
        <tr><td>*Your Email:</td><td><input name="OWNER_EMAIL"></td></tr>
        <tr><td>*Category:</td><td><select name="CATEGORY_ID"><option value="1">Sports</option></select></td></tr>
        <tr><td align="right">Reciprocal Link URL:</td><td><input name="RECPR_URL"><textarea name="RECPR_TEXT" readonly>Site link</textarea></td></tr>
        <tr><td></td><td><input type="submit" name="submit" value="Submit"></td></tr>
        </table></form>'''
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            methods = serve(page, html)
            prepare(page, 'lemon-directory.com', BUSINESS, {}, {}, False)
            self.assertEqual(page.locator('[name="RECPR_URL"]').input_value(), '')
            self.assertIn(BUSINESS['website'], page.locator('[name="DESCRIPTION"]').input_value())
            page.locator('[name="RECPR_URL"]').evaluate('(e)=>e.closest("tr").querySelector("td").textContent="* Reciprocal required"')
            self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
            self.assertTrue(all(method == 'GET' for method in methods))
            browser.close()

    def test_confirmed_optional_reciprocal_stays_empty_and_required_change_stops(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for host in ('aurora-directory.com', 'unique-listing.com', 'expansiondirectory.com', 'fruity-directory.com', 'relevantdirectory.biz', 'relevantdirectories.com'):
                site = IMPORTED_DIRECTORIES[host]
                page = browser.new_page()
                methods = serve(page, fixture_file(host, site).read_text(encoding='utf-8'))
                with patch('builtins.input', return_value=''):
                    prepare(page, host, BUSINESS, {}, {}, True)
                self.assertEqual(page.locator('[name="RECPR_URL"]').input_value(), '')
                self.assertIn(BUSINESS['website'], page.locator('[name="DESCRIPTION"]').input_value())
                if host == 'expansiondirectory.com':
                    self.assertIn('Recreation & Sports', page.locator('[name="CATEGORY_ID"] option:checked').inner_text())
                field = page.locator('[name="RECPR_URL"]')
                field.evaluate('(el)=>el.required=true')
                self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                field.evaluate('(el)=>{el.required=false;el.value="https://unexpected.example/";}')
                self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                field.evaluate('(el)=>{el.value="";el.closest("tr").querySelector("td").textContent="* Reciprocal required";}')
                self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                self.assertTrue(all(method == 'GET' for method in methods))
                page.close()
            browser.close()

    def test_catalog_and_source_provenance(self):
        self.assertEqual(len(IMPORTED_DIRECTORIES), 28)
        self.assertTrue(set(IMPORTED_DIRECTORIES) <= DIRECTORIES)
        # A live correction can override an imported hostname without adding a site.
        self.assertEqual(len(SUPPORTED), 67 + len(LIVE_DIRECTORIES.keys() - IMPORTED_DIRECTORIES.keys()))
        self.assertIn('telegra.ph', SUPPORTED)
        with (ROOT / 'mappings/external_sites.csv').open(encoding='utf-8-sig', newline='') as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len({row['domain'] for row in rows}), 100)
        self.assertEqual(sum(row['integration_status'] == 'reference_only' for row in rows), 71)
        for site in IMPORTED_DIRECTORIES.values():
            self.assertEqual(hashlib.sha256((ROOT / site['source']).read_bytes()).hexdigest(), site['source_sha256'])

    def test_all_28_source_forms_and_rejection_of_changed_controls(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for host, site in IMPORTED_DIRECTORIES.items():
                with self.subTest(host=host):
                    page = browser.new_page()
                    methods = serve(page, fixture_file(host, site).read_text(encoding='utf-8'))
                    page.goto(submission_url(site))
                    result = page.evaluate(DIRECTORY_INSPECTOR, site)
                    self.assertTrue(result['ok'], result)
                    if site.get('manualRadio'):
                        cell = page.locator('[name="LINK_TYPE"]').locator('xpath=ancestor::tr').locator('td').last
                        cell.evaluate("el => el.textContent = '$5'")
                        self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                        cell.evaluate("el => el.textContent = 'free'")
                    page.locator('[name="TITLE"]').evaluate('(el) => el.hidden = true')
                    self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                    page.locator('[name="TITLE"]').evaluate('(el) => el.hidden = false')
                    page.locator('form').filter(has=page.locator('[name="TITLE"]')).evaluate("el => el.action = 'https://other.example/submit.php'")
                    self.assertFalse(page.evaluate(DIRECTORY_INSPECTOR, site)['ok'])
                    self.assertTrue(all(method == 'GET' for method in methods))
                    page.close()
            browser.close()

    def test_new_directory_is_used_by_both_runners_without_submission(self):
        host = 'toptendir.net'
        site = IMPORTED_DIRECTORIES[host]
        html = fixture_file(host, site).read_text(encoding='utf-8')
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            methods = serve(page, html)
            # CAPTCHA markup belongs to an offline HTML fixture, not a live challenge.
            with patch('builtins.input', return_value=''):
                selector, _ = prepare(page, host, BUSINESS, {}, {}, True)
            self.assertEqual(page.locator('[name="URL"]').input_value(), BUSINESS['website'])
            self.assertEqual(page.locator(selector).input_value(), 'Continue')
            page.goto(submission_url(site))
            job = make_job(BUSINESS, host)
            # Execute the real Ui.Vision script with DOM-backed commands. goto is
            # a no-op because this intercepted page already has the exact URL.
            bridge = '''const values = {}; const commands = [];
              const uiv = {goto() {}, getVar: key => values[key], $() {},
                log(text) { values.result = JSON.parse(text.split('BACKLINK_RESULT:')[1]); },
                run(command, target, value) {
                  commands.push(command);
                  if (command === 'executeScript') values[value] = new Function(target)();
                  const el = target.startsWith('css=') ? document.querySelector(target.slice(4)) : null;
                  if (command === 'type') el.value = value;
                  if (command === 'select') el.value = value.slice(6);
                  if (command === 'check') el.checked = true;
                  if (command === 'click') throw Error('Unexpected submission during fixture');
                }};
            '''
            source = 'const importedDirectoryInspector = ' + json.dumps(DIRECTORY_INSPECTOR) + ';\n'
            source += 'const contentFitter = ' + json.dumps(CONTENT_FITTER) + ';\n'
            source += 'const categoryMatcher = ' + json.dumps(CATEGORY_MATCHER) + ';\n'
            source += 'const job = ' + json.dumps(job) + '; const stage = "prepare";\n'
            result = page.evaluate('() => {' + bridge + source + SCRIPT.read_text(encoding='utf-8') + '; return values.result; }')
            self.assertEqual(result['status'], 'ready')
            self.assertEqual(page.locator('[name="URL"]').input_value(), BUSINESS['website'])
            page.locator('iframe,.g-recaptcha,.h-captcha,.cf-turnstile').evaluate_all('(els) => els.forEach(el => el.remove())')
            page.locator('form').evaluate("el => el.action = 'https://other.example/submit.php'")
            guard = source.replace('const stage = "prepare"', 'const stage = "submit"')
            error = page.evaluate('() => {' + bridge + guard +
                                  'try {' + SCRIPT.read_text(encoding='utf-8') +
                                  '; return "unexpected success";} catch(e) { return e.message; }}')
            self.assertIn('form action changed', error)
            self.assertEqual(urlsplit(page.url).hostname, host)
            self.assertTrue(all(method == 'GET' for method in methods))
            browser.close()


if __name__ == '__main__':
    unittest.main()
