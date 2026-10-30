"""Complete category capture, scoped decisions, and safe reuse; no live publishing."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from playwright.sync_api import sync_playwright
from mappings.category_records import observe,record_rule,saved_rule,topic_key
from mappings.categories import category_choice
from uivision_publish import run_stage,run_queue
from uivision import tool_text

BUSINESS={'name':'Example Battery','website':'https://business.example/','description':'Battery replacement and roadside help',
          'category':'Automotive','category_fallbacks':['Roadside Assistance','Business & Services']}
OPTIONS=[{'text':'Choose category','value':'0','disabled':False},
         {'text':'|___Business','value':'business','disabled':False},
         {'text':'|___Computers','value':'computer','disabled':False},
         {'text':'Unavailable','value':'off','disabled':True}]

class CategoryRecordsChecks(unittest.TestCase):
    def test_capture_all_options_and_save_explained_topic_scoped_rule(self):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d);rules=folder/'rules.json'
            path=observe('directory.test',BUSINESS,OPTIONS,'https://directory.test/submit.php?private=not-kept',folder=folder)
            r=json.loads(path.read_text());v=r['versions'][r['latest_fingerprint']]
            self.assertEqual(v['option_count'],4);self.assertEqual(v['page'],'https://directory.test/submit.php')
            rule=record_rule('directory.test',BUSINESS,'business','Broader Business option is accurate; no automotive option exists',folder=folder,rules_path=rules)
            self.assertEqual(rule['selected']['label'],'|___Business')
            self.assertEqual(saved_rule('directory.test',BUSINESS,rules),rule)
            self.assertIsNone(saved_rule('directory.test',{'category':'Sports'},rules))
            self.assertIsNone(saved_rule('another.test',BUSINESS,rules))
            self.assertEqual(topic_key(BUSINESS),topic_key({**BUSINESS,'name':'Another Battery Client'}))
            with self.assertRaises(ValueError):record_rule('directory.test',BUSINESS,'off','disabled',folder=folder,rules_path=rules)
            with self.assertRaises(ValueError):record_rule('directory.test',BUSINESS,'missing','invented',folder=folder,rules_path=rules)
            decision=list(json.loads(path.read_text())['decisions'].values())[0]
            self.assertEqual(decision['selected']['value'],'business')
            self.assertEqual(json.loads(path.read_text())['versions'][r['latest_fingerprint']]['page'],'https://directory.test/submit.php')

    def test_all_options_survive_large_inventory_and_duplicate_values_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            many=[{'label':f'Category {i}','value':str(i+1)} for i in range(1500)]
            path=observe('directory.test',BUSINESS,many,folder=Path(d))
            r=json.loads(path.read_text());self.assertEqual(r['versions'][r['latest_fingerprint']]['option_count'],1500)
            observe('directory.test',BUSINESS,[OPTIONS[1],OPTIONS[1]],folder=Path(d))
            with self.assertRaises(ValueError):record_rule('directory.test',BUSINESS,'business','ambiguous value',folder=Path(d),rules_path=Path(d)/'rules.json')

    def test_saved_choice_requires_live_enabled_value_and_label(self):
        with sync_playwright() as p:
            browser=p.chromium.launch();page=browser.new_page()
            rule={'selected':{'label':'|___Business','value':'business'}}
            profile={**BUSINESS,'category_rule':rule}
            self.assertEqual(category_choice(page,OPTIONS,profile)['value'],'business')
            self.assertIsNone(category_choice(page,[{**OPTIONS[1],'text':'Veterinary'}],profile))
            self.assertIsNone(category_choice(page,[{**OPTIONS[1],'disabled':True}],profile))
            self.assertIsNone(category_choice(page,[OPTIONS[2]],profile))
            browser.close()

    def test_review_stops_queue_before_submit_and_preserves_inventory_pointer(self):
        entries=[{'domain':'smartdir.org','row':1},{'domain':'efdir.com','row':2}]
        result={'status':'category_review','reason':'Category mapping review needed',
                'category_options_path':'mappings/category_options/smartdir.org.json'}
        state={}
        with tempfile.TemporaryDirectory() as d,patch('uivision_publish.run_stage',return_value=result) as stage:
            run_queue(None,None,BUSINESS,entries,state,Path(d),all_sites=True)
            self.assertEqual(stage.call_count,1)
            self.assertEqual(stage.call_args.args[2],'prepare')
            host=stage.call_args.args[1]['domain']
            self.assertEqual(state[host]['status'],'needs_mapping')
            self.assertEqual(state[host]['category_options_path'],result['category_options_path'])
            self.assertNotIn('submitting',[x['status'] for x in state.values()])

    def test_browser_result_saves_full_inventory_outside_campaign_secrets(self):
        class Client:
            def call(self,*args,**kwargs):
                payload={'status':'category_review','category_evidence':{'options':OPTIONS,'selected':None,'page':'https://directory.test/submit.php'}}
                return {'content':[{'type':'text','text':'BACKLINK_RESULT:'+json.dumps(payload)}]}
        with patch('uivision_publish.observe_categories', return_value=Path('mappings/category_options/directory.test.json').resolve()) as capture:
            result=run_stage(Client(),{**BUSINESS,'domain':'directory.test'},'prepare')
            self.assertIn('category_options_path',result)
            self.assertEqual(capture.call_args.args[2], OPTIONS)

if __name__=='__main__':unittest.main()
