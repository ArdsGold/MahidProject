"""Journal and independently verify a discovered public candidate; never submits."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backlinks import load_workbook, campaign_folder, campaign_lock, check_public_url, save, stamp, verify
from website_pool import merge_pool, progress_message, refresh_pool
from mappings.common import publication_domain
from playwright.sync_api import sync_playwright

host, url = sys.argv[1:]
business, entries = load_workbook('.local/workbooks/Cheer_Athletics_St_Louis.xlsx')
entries = merge_pool(entries, 'websites/Website_Pool.xlsx', '.local/workbooks/Cheer_Athletics_St_Louis.xlsx')
folder = campaign_folder(business)
with campaign_lock(folder / '.lock'):
    state = json.loads((folder / 'state.json').read_text(encoding='utf-8'))
    previous = state.get(host, {})
    public_host = publication_domain(host, previous)
    check_public_url(url, public_host)
    if previous.get('status') == 'published':
        raise SystemExit('Already verified; no change.')
    origin = previous.get('listing_origin') or ('existing' if previous.get('status') == 'rejected' else 'new')
    state[host] = {**previous, 'status': 'unverified', 'candidate_url': url, 'listing_origin': origin,
                   'reason': 'Discovered public candidate awaiting independent verification', 'checked_utc': stamp()}
    save(state, folder, entries)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            state[host].update(verify(browser, url, business, public_host))
        except Exception as error:
            state[host].update(reason='Saved candidate not independently verified; no repost', checked_utc=stamp())
            print('Verification:', type(error).__name__)
        finally:
            browser.close()
            save(state, folder, entries)
    refresh_pool('websites/Website_Pool.xlsx', campaign=folder)
    print(host, state[host]['status'])
    if state[host]['status'] == 'published':
        print(state[host]['url'])
    print(progress_message(state, 100))
