"""Protocol checks with a fake local bridge; never opens a browser."""
import sys
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from uivision import BridgeError, UiVision, redact_token, tool_text
from uivision_publish import make_job, prompt, run_queue, inspect_uncertain
from backlinks import NeedsAttention


class UiVisionChecks(unittest.TestCase):
    def test_uncertain_receipt_inspection_resolves_without_another_submit(self):
        host = 'getadsonline.com'
        business = {'name': 'Example Business', 'website': 'https://business.example/',
                    'description': 'Approved description', 'category': 'Sports'}
        for receipt in ({'status': 'pending', 'reason': 'Awaiting moderation'},
                        {'status': 'candidate', 'url': 'https://getadsonline.com/listing/42'},
                        {'status': 'uncertain'}):
            with self.subTest(receipt=receipt['status']), tempfile.TemporaryDirectory() as d:
                state = {host: {'status': 'uncertain', 'submission_id': 'original'}}
                verified = {'status': 'published', 'url': 'https://getadsonline.com/listing/42'}
                with patch('uivision_publish.run_stage', return_value=receipt) as stage, \
                     patch('uivision_publish.verify', return_value=verified):
                    if receipt['status'] == 'uncertain':
                        with self.assertRaises(NeedsAttention):
                            inspect_uncertain(None, None, business, host, state, Path(d), [{'row': 1, 'domain': host}])
                    else:
                        inspect_uncertain(None, None, business, host, state, Path(d), [{'row': 1, 'domain': host}])
                    self.assertEqual([c.args[2] for c in stage.call_args_list], ['receipt'])
                self.assertEqual(state[host]['submission_id'], 'original')
                self.assertEqual(state[host]['status'], {'pending': 'pending', 'candidate': 'published', 'uncertain': 'uncertain'}[receipt['status']])

    def test_missing_terminal_is_a_recoverable_verification_pause(self):
        with patch('builtins.input', side_effect=EOFError):
            with self.assertRaisesRegex(NeedsAttention, 'terminal'):
                prompt('Verification: ')

    def test_browser_workflow_offline(self):
        result = subprocess.run(['node', 'test_uivision_workflow.cjs'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_queue_journals_before_click_and_never_repeats_inflight_work(self):
        business = {'name': 'Example Gym', 'website': 'https://business.example/', 'description': 'Approved',
                    'address': '10 Main St, St. Louis, MO 63146, United States', 'category': 'Sports', 'email': 'public@example.com'}
        self.assertEqual(make_job(business, 'letspostfree.com')['state_name'], 'Missouri')
        entries = [{'row': 1, 'domain': 'letspostfree.com'}, {'row': 2, 'domain': 'getadsonline.com'},
                   {'row': 3, 'domain': 'postquickads.com'}, {'row': 4, 'domain': 'pclassified.com'}]
        state = {'getadsonline.com': {'status': 'published', 'url': 'https://getadsonline.com/posts/old'},
                 'postquickads.com': {'status': 'pending'}, 'pclassified.com': {'status': 'uncertain'}}
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            def stage(client, job, action):
                if action == 'prepare': return {'status': 'ready', 'challenge': False}
                journal = json.loads((folder / 'state.json').read_text())
                self.assertEqual(journal[job['domain']]['status'], 'submitting')
                raise KeyboardInterrupt
            with patch('uivision_publish.run_stage', side_effect=stage):
                with self.assertRaises(KeyboardInterrupt):
                    run_queue(None, None, business, entries, state, folder)
            self.assertEqual(state['letspostfree.com']['status'], 'submitting')
            with patch('uivision_publish.run_stage', return_value={'status': 'uncertain'}) as stages:
                with self.assertRaises(NeedsAttention):
                    run_queue(None, None, business, entries, state, folder)
                self.assertEqual([c.args[2] for c in stages.call_args_list], ['receipt'])

    def test_protocol_ignores_notifications_and_surfaces_errors(self):
        fake = '''import sys,json
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 print(json.dumps({'jsonrpc':'2.0','method':'notifications/message'}),flush=True)
 if m['method']=='initialize': r={'protocolVersion':'2024-11-05'}
 elif m['params']['name']=='fail': r={'isError':True,'content':[{'type':'text','text':'Required field changed'}]}
 else: r={'content':[{'type':'text','text':'Connected'}]}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':r}),flush=True)
'''
        with UiVision([sys.executable, '-u', '-c', fake]) as client:
            self.assertEqual(tool_text(client.call('bridge_status')), 'Connected')
            with self.assertRaisesRegex(BridgeError, 'Required field changed'):
                client.call('fail')
        self.assertIsNotNone(client.process.poll())

    def test_diagnostics_do_not_print_pairing_token(self):
        message = 'Only if Test reports it, paste into the token field:  private-token-value\nNext step'
        self.assertNotIn('private-token-value', redact_token(message))
        self.assertIn('Next step', redact_token(message))


if __name__ == '__main__':
    unittest.main()
