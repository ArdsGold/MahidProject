"""Offline classic-editor guard checks. No live publication."""
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright


class ClassicEditorChecks(unittest.TestCase):
    def test_editor_serialization_preserves_public_text_and_exact_links(self):
        guard = Path('mappings/wordpress_classic_content_guard.js').read_text(encoding='utf-8')
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content('<input name="post_title" value="Example Gym"><textarea id="content"></textarea><a href="https://example.blog.test/">Visit Site</a>')
            approved = '<h1>Example Gym</h1><p>Hours: Monday<br>15:00-21:00</p><p><a href="https://business.example/location/">Official website</a></p>'
            normalized = '<h1>Example Gym</h1>\n<p>Hours: Monday<br />\n15:00-21:00</p>\n<p><a href="https://business.example/location/">Official website</a></p>'
            config = {'title': 'Example Gym', 'html': approved, 'website': 'https://business.example/location/', 'public_host': 'example.blog.test'}
            page.locator('#content').fill(normalized)
            self.assertTrue(page.evaluate(guard, config)['ok'])
            page.locator('#content').fill(normalized.replace('15:00-21:00', '15:00-20:00'))
            self.assertFalse(page.evaluate(guard, config)['ok'])
            page.locator('#content').fill(normalized.replace('/location/', '/another-location/'))
            self.assertFalse(page.evaluate(guard, config)['ok'])
            page.locator('#content').fill(normalized + '<script>unapproved()</script>')
            self.assertFalse(page.evaluate(guard, config)['ok'])
            browser.close()

    def test_native_action_clobbering_and_changed_publication_controls(self):
        guard = Path('mappings/wordpress_classic_guard.js').read_text(encoding='utf-8')
        html = '''<form method="post"><input type="hidden" name="action" value="editpost">
          <input name="post_title"><textarea id="content" name="content"></textarea>
          <input id="publish" name="publish" type="submit" value="Publish"></form>
          <span id="post-visibility-display">Public</span><span id="post-status-display">Draft</span>'''
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            calls = []
            def serve(route):
                calls.append(route.request.method)
                route.fulfill(body=html, content_type='text/html')
            page.route('**/*', serve)
            page.goto('https://fixture.test/new-post')
            config = {'host': 'fixture.test', 'path': '/new-post'}
            self.assertTrue(page.evaluate(guard, config)['ok'])
            page.locator('#publish').evaluate('(e)=>e.classList.add("disabled")')
            self.assertFalse(page.locator('#publish').is_disabled())
            self.assertFalse(page.evaluate(guard, config)['ok'])
            page.locator('#publish').evaluate('(e)=>e.classList.remove("disabled")')
            page.locator('#publish').evaluate('(e)=>e.setAttribute("aria-disabled","true")')
            self.assertFalse(page.evaluate(guard, config)['ok'])
            page.locator('#publish').evaluate('(e)=>e.removeAttribute("aria-disabled")')
            self.assertTrue(page.evaluate(guard, config)['ok'])
            page.locator('#publish').evaluate('(e)=>e.value="Pay Now"')
            self.assertFalse(page.evaluate(guard, config)['ok'])
            page.locator('#publish').evaluate('(e)=>e.value="Publish"')
            page.locator('#post-visibility-display').evaluate('(e)=>e.textContent="Private"')
            self.assertFalse(page.evaluate(guard, config)['ok'])
            page.locator('#post-visibility-display').evaluate('(e)=>e.textContent="Public"')
            page.locator('form').evaluate('(e)=>e.action="https://other.test/new-post"')
            self.assertFalse(page.evaluate(guard, config)['ok'])
            self.assertTrue(all(method == 'GET' for method in calls))
            browser.close()
