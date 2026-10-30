"""Validate a signed-in site's actual classic editor before supervised publication."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from uivision import UiVision, tool_text
from map_websites import snapshot, read_record, write_record
from site_access import private_load, auth_flags
from website_pool import read_pool
from backlinks import stamp

host = sys.argv[1]
assert host in {r['domain'] for r in read_pool('websites/Website_Pool.xlsx') if r['enabled'] == 'Yes'}
assert private_load(host).get('registration') == 'completed'
try:
    with UiVision() as client:
        client.call('select_browser', {'target': 'chrome#1', 'why': 'Validate the observed classic editor using the confirmed shared workflow.'})
        dashboard = snapshot(client)
        assert dashboard['host'] == host and auth_flags(client).get('authenticated_navigation')
        controls = [x for x in dashboard.get('controls', []) if x['label'] in ('New Post', 'Write your first blog post')
                    and x.get('url') == 'https://' + host + '/new-post']
        assert controls, 'No observed posting control matches the confirmed template'
        editor = snapshot(client, controls[0]['url'])
        source = Path('mappings/wordpress_classic_guard.js').read_text(encoding='utf-8')
        code = 'return (' + source + ')(' + json.dumps({'host': host, 'path': '/new-post'}) + ');'
        script = 'uiv.run("executeScript",' + json.dumps(code) + ',"g");uiv.log("GUARD:"+JSON.stringify(uiv.getVar("g")));'
        raw = tool_text(client.call('run_macro', {'script': script, 'look': 'none', 'log_limit': 1500}))
        guard = json.loads(re.findall(r'GUARD:(\{[^\n]*\})', raw)[-1])
        assert guard.get('ok')
        code = 'return !document.querySelector("[name=post_title]").value.trim()&&!document.querySelector("#content").value.trim();'
        script = 'uiv.run("executeScript",' + json.dumps(code) + ',"empty");uiv.log("EMPTY:"+JSON.stringify(uiv.getVar("empty")));'
        raw = tool_text(client.call('run_macro', {'script': script, 'look': 'none', 'log_limit': 800}))
        assert 'EMPTY:true' in raw
        reference = read_record('blog-gold.com')
        layout = read_record(host)
        layout.update(status='Form blueprint saved', runtime='Supervised guarded publication; automatic queue adapter not enabled',
            family='wordpress-classic-blog', access='Signed in; actual final public posting form validated',
            review_reason='', completion_level='Final posting form reached; publication untested',
            verification_level='Live account and final form validated', field_map=reference['field_map'],
            publishing_contract=reference['publishing_contract'], native_guard=guard,
            posting_button_confirmation={'confirmed_by': 'validated_template', 'source_domain': 'blog-gold.com',
                'confirmed_utc': stamp(), 'controls': controls,
                'evidence': 'Exact observed labels/routes match the confirmed classic workflow; live final form passed its guard'})
        layout.setdefault('pages', []).extend([dashboard, editor])
        write_record(layout)
        print(host, 'validated classic editor', flush=True)
except Exception as error:
    Path('.local/' + host + '-classic-inspection-error.txt').write_text(str(error), encoding='utf-8')
    print('Editor inspection:', type(error).__name__, flush=True)
