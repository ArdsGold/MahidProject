"""Inspect one pool website in the selected regular Chrome; publication remains separately journaled."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from uivision import UiVision
from website_pool import read_pool, refresh_pool
from map_websites import inspect_site, export_index
from site_access import shared_credentials

host = sys.argv[1]
rows = read_pool('websites/Website_Pool.xlsx')
row = next(r for r in rows if r['domain'] == host and r['enabled'] == 'Yes')
try:
    with UiVision() as client:
        client.call('select_browser', {'target': 'chrome#1', 'why': 'Continue the operator-authorized mapping and publishing workflow.'})
        client.call('run_macro', {'script': 'uiv.goto(' + json.dumps(row['website']) + ');', 'look': 'none', 'log_limit': 200})
        record = inspect_site(client, row, credentials=shared_credentials('.local/workbooks/Cheer_Athletics_St_Louis.xlsx', host))
        print(host, record['status'], flush=True)
except Exception as error:
    Path('.local/' + host + '-continuation-error.txt').write_text(str(error), encoding='utf-8')
    print('Inspection needs follow-up:', type(error).__name__, flush=True)
finally:
    export_index(rows)
    try:
        refresh_pool('websites/Website_Pool.xlsx')
    except PermissionError:
        print('Close Excel before refreshing pool labels.', flush=True)
