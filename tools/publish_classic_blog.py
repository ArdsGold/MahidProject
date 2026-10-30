"""Supervised, journaled publication through the two live-inspected classic blog editors."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backlinks import load_workbook, campaign_folder, campaign_lock, save, stamp, verify, check_public_url
from website_pool import merge_pool, begin_attempt, progress_message, refresh_pool
from mappings.common import content_parts, publication_domain
from mappings.editors import article_html
from uivision import UiVision, tool_text
from site_access import auth_flags, private_load
from playwright.sync_api import sync_playwright

host = sys.argv[1]
from map_websites import read_record
from website_pool import read_pool
assert host in {r['domain'] for r in read_pool('websites/Website_Pool.xlsx') if r['enabled'] == 'Yes'}
layout = read_record(host)
assert layout.get('family') == 'wordpress-classic-blog' and layout.get('native_guard', {}).get('ok')
assert layout.get('publishing_contract', {}).get('guard') == 'mappings/wordpress_classic_guard.js'
business, entries = load_workbook('.local/workbooks/Cheer_Athletics_St_Louis.xlsx')
entries = merge_pool(entries, 'websites/Website_Pool.xlsx', '.local/workbooks/Cheer_Athletics_St_Louis.xlsx')
folder = campaign_folder(business)
account = private_load(host)
assert account.get('registration') == 'completed'
public_host = account['blog_name'].lower() + '.' + host
publication_domain(host, {'publication_host': public_host})
parts = content_parts(business)
assert not parts['omitted_fields'], 'Source text needs correction'
html = article_html(business)
guard = Path('mappings/wordpress_classic_guard.js').read_text(encoding='utf-8')
check_code = 'return (' + guard + ')(' + json.dumps({'host': host, 'path': '/new-post'}) + ');'
check_script = 'uiv.run("executeScript",' + json.dumps(check_code) + ',"guard");if(!uiv.getVar("guard").ok)throw Error(uiv.getVar("guard").reason);'

def run(client, script):
    return tool_text(client.call('run_macro', {'script': script, 'look': 'none', 'log_limit': 2000}, timeout=180))

with campaign_lock(folder / '.lock'):
    state = json.loads((folder / 'state.json').read_text(encoding='utf-8'))
    previous = state.get(host, {})
    if previous.get('status', 'not_run') not in {'not_run', 'needs_attention', 'needs_mapping', 'failed'} or previous.get('candidate_url'):
        raise SystemExit('Protected campaign result; no publication repeated.')
    started = False
    try:
        with UiVision() as client:
            client.call('select_browser', {'target': 'chrome#1', 'why': 'Publish the approved post through its inspected classic editor.'})
            flags = auth_flags(client)
            assert not any(flags.get(k) for k in ('captcha', 'account_restricted', 'identity', 'payment'))
            ready = 'uiv.$(' + json.dumps('css=#publishing-action #publish:not(.disabled):not([disabled]):not([aria-disabled="true"])') + ',{timeout:20});'
            run(client, ready + check_script)
            # Use the editor's own HTML tab, then ordinary input commands.
            prepare = check_script + 'uiv.run("type","name=post_title",' + json.dumps(business['name']) + ');uiv.run("click","id=content-html");uiv.run("type","id=content",' + json.dumps(html) + ');'
            run(client, prepare)
            content_check = Path('mappings/wordpress_classic_content_guard.js').read_text(encoding='utf-8')
            content_check = 'return (' + content_check + ')(' + json.dumps({
                'title': business['name'], 'html': html, 'website': business['website'], 'public_host': public_host}) + ');'
            validate = check_script + 'uiv.run("executeScript",' + json.dumps(content_check) + ',"contentCheck");if(!uiv.getVar("contentCheck").ok)throw Error(uiv.getVar("contentCheck").reason);'
            run(client, ready + validate)
            flags = auth_flags(client)
            if any(flags.get(k) for k in ('captcha', 'account_restricted', 'identity', 'payment')):
                raise RuntimeError('Verification or account restriction before publication')
            begin_attempt(folder, host)
            state[host] = {'status': 'submitting', 'publication_host': public_host,
                           'reason': 'Classic blog final Publish started', 'checked_utc': stamp(),
                           'omitted_fields': [], 'content_notes': 'All approved public fields included; exact website hyperlink'}
            save(state, folder, entries)
            started = True
            run(client, ready + validate + 'uiv.browser.click(uiv.$("css=#publishing-action #publish"));')
            try:
                run(client, 'uiv.$(' + json.dumps('xpath=//a[normalize-space(.)="View your post"]') + ',{timeout:20});')
            except Exception as error:
                Path('.local/' + host + '-receipt-wait.txt').write_text(str(error), encoding='utf-8')
            # Read only after the one final click. Never click Publish again to recover a URL.
            candidate = ''
            for _ in range(3):
                code = '''const wanted=HOST;return {published:/post published|post successfully published/i.test(document.body.innerText),
                  urls:[...document.querySelectorAll('a[href]')].filter(a=>/view (?:your )?post|permalink/i.test(a.textContent+' '+a.id)).map(a=>a.href).filter(v=>{
                  try{const u=new URL(v);return u.protocol==='https:'&&u.hostname===wanted&&u.pathname!=='/'&&!u.search&&!u.hash&&!/edit|preview|admin/i.test(u.pathname);}catch{return false;}})};'''.replace('HOST', json.dumps(public_host))
                raw = run(client, 'uiv.run("executeScript",' + json.dumps(code) + ',"receipt");uiv.log("BLOG_RESULT:"+JSON.stringify(uiv.getVar("receipt")));')
                matches = re.findall(r'BLOG_RESULT:(\{[^\n]*\})', raw)
                receipt = json.loads(matches[-1])
                if receipt['urls']:
                    candidate = receipt['urls'][0]
                    break
            state[host].update(status='unverified' if candidate else 'pending' if receipt.get('published') else 'uncertain',
                               reason='Public URL awaiting independent verification' if candidate else 'No independently verified public URL recovered', checked_utc=stamp())
            if candidate:
                check_public_url(candidate, public_host)
                state[host]['candidate_url'] = candidate
                save(state, folder, entries)
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch()
                    try:
                        state[host].update(verify(browser, candidate, business, public_host))
                    finally:
                        browser.close()
    except Exception as error:
        Path('.local/' + host + '-publish-error.txt').write_text(str(error), encoding='utf-8')
        if started and state[host]['status'] == 'submitting':
            state[host].update(status='uncertain', reason='Publication interrupted; inspect before any retry')
        print('Follow-up needed:', type(error).__name__)
    finally:
        save(state, folder, entries)
    if state.get(host, {}).get('status') == 'published':
        from map_websites import read_record, write_record, export_index
        layout = read_record(host)
        layout.update(status='Form blueprint saved', runtime='Supervised publication verified; automatic queue adapter not enabled',
                      access='Signed in; publication independently verified', review_reason='', remaining=[],
                      completion_level='Published backlink independently verified for current campaign',
                      verification_level='Live final form, receipt and independently verified public detail page',
                      publication_verification={'campaign_url': state[host]['url'], 'checked_utc': stamp()})
        write_record(layout)
        export_index(read_pool('websites/Website_Pool.xlsx'))
    refresh_pool('websites/Website_Pool.xlsx', campaign=folder)
    print(host, state.get(host, {}).get('status'))
    if state.get(host, {}).get('status') == 'published':
        print(state[host]['url'])
    print(progress_message(state, 100))
