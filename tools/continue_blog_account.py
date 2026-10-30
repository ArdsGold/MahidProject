import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from uivision import UiVision
from map_websites import snapshot, read_record, write_record
from site_access import automate_access, shared_credentials, private_load

host = sys.argv[1]
from website_pool import read_pool
assert host in {row['domain'] for row in read_pool('websites/Website_Pool.xlsx') if row['enabled'] == 'Yes'}
try:
    with UiVision() as client:
        client.call('select_browser', {'target': 'chrome#1', 'why': 'Continue registration after the saved explicit login rejection.'})
        page = snapshot(client)
        assert page['host'] == host
        assert private_load(host).get('account_attempts', {}).get('login') == 'rejected'
        page, reason = automate_access(client, host, page,
            shared_credentials('.local/workbooks/Cheer_Athletics_St_Louis.xlsx'), snapshot)
        Path('.local/' + host + '-account-result.json').write_text(json.dumps(page), encoding='utf-8')
        layout = read_record(host)
        layout.setdefault('pages', []).append(page)
        layout.update(access=reason or 'Signed in; posting editor needs inspection',
                      review_reason=reason, status='Needs review' if reason else 'Entry points saved; form incomplete')
        write_record(layout)
        print(json.dumps({'host': host, 'reason': reason, 'account_status': private_load(host).get('status')}), flush=True)
except Exception as error:
    Path('.local/' + host + '-account-error.txt').write_text(str(error), encoding='utf-8')
    print('Account inspection required:', type(error).__name__, flush=True)
