"""Automotive routing, chunked inventories and preserved sports support; entirely offline."""
import json,re,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote,parse_qs,urlsplit
from playwright.sync_api import sync_playwright
from mappings.classified_routes import category_route,location
from mappings.category_records import capture_options
from mappings.playwright import prepare
from uivision_publish import make_job
from uivision import BridgeError

BATTERY={'name':'Example Battery','category':'Automotive','description':'Battery replacement and roadside help',
         'city':'Chicago','region':'IL','country':'US','address':'1929 S State St Unit 3, Chicago, IL 60616',
         'email':'public@business.example','website':'https://business.example/about-us/'}

class ClassifiedRoutesChecks(unittest.TestCase):
    def test_topic_and_structured_us_location_choose_automotive_without_country_in_address(self):
        self.assertEqual(category_route(BATTERY)['labels'],['Services','Motors'])
        self.assertEqual(location(BATTERY),('Chicago','Illinois'))
        self.assertEqual(location({'address':BATTERY['address']}),('Chicago','Illinois'))
        self.assertIsNone(location({**BATTERY,'country':'Canada'}))
        job=make_job(BATTERY,'getadsonline.com')
        self.assertEqual(job['state_name'],'Illinois');self.assertEqual(job['classified_route']['labels'],['Services','Motors'])
        self.assertEqual(category_route({'category':'Sports'})['labels'],['Services','Health & Fitness'])
        self.assertIsNone(category_route({'category':'Plumbing'}))

    def test_long_dropdown_is_captured_without_truncation_and_missing_chunks_fail(self):
        options=[{'text':'Category '+str(i)+' \u2013 regional','value':str(i),'disabled':False} for i in range(200)]
        payload=quote(json.dumps(options),safe="~()*!.'-")
        class Client:
            broken=False
            def call(self,tool,args,**kw):
                start=int(re.search(r'for\(let i=(\d+)',args['script']).group(1))
                chunks=range(start,min(start+10,(len(payload)+159)//160))
                text='CATEGORY_LENGTH:'+str(len(payload))+'\n'+'\n'.join('CATEGORY_CHUNK:'+str(i)+':'+payload[i*160:(i+1)*160] for i in chunks if not self.broken or i!=start)
                return {'content':[{'type':'text','text':text}]}
        self.assertEqual(capture_options(Client(),'[name="CATEGORY_ID"] option',len(options)),options)
        broken=Client();broken.broken=True
        with self.assertRaises(BridgeError):capture_options(broken,'[name="CATEGORY_ID"] option',len(options))

    def test_playwright_follows_real_automotive_links_and_reaches_form_without_posting(self):
        visited=[];methods=[]
        with sync_playwright() as p:
            browser=p.chromium.launch();page=browser.new_page()
            def respond(route):
                visited.append(route.request.url);methods.append(route.request.method)
                q=parse_qs(urlsplit(route.request.url).query)
                if 'subcatid' in q:
                    html='''<form><input id="adtitle"><textarea name="addesc"></textarea><input id="email"><select name="arealist"><option value="chicago">Chicago</option></select><input name="area"><select name="promote[featured]"><option value="0">None</option></select><select name="promote[extended]"><option value="0">None</option></select><input type="checkbox" name="agree"><button type="submit">Post Now</button></form>'''
                elif 'catid' in q:
                    html='<a href="?view=post&cityid=463&catid=3&subcatid=26">Motors</a><a href="?view=post&cityid=463&catid=3&subcatid=29">Health &amp; Fitness</a>'
                elif q.get('cityid')==['463']:
                    html='<a href="?view=post&cityid=463&catid=3">Services</a>'
                else:html='<a href="?view=post&cityid=463">Illinois</a>'
                route.fulfill(status=200,content_type='text/html',body=html)
            page.route('**/*',respond)
            record={}
            with patch('mappings.playwright.observe_route') as capture:
                selector,_=prepare(page,'getadsonline.com',BATTERY,{},record,False)
            self.assertIn('Post Now',selector)
            self.assertEqual(page.locator('#adtitle').input_value(),'Example Battery')
            self.assertEqual(record['selected_category']['label'],'Services > Motors')
            self.assertEqual(parse_qs(urlsplit(visited[-1]).query)['subcatid'],['26'])
            self.assertTrue(all('subcatid=29' not in v for v in visited))
            self.assertEqual(capture.call_args.args[2][-1]['selected']['label'],'Motors')
            self.assertEqual(page.locator('[name="promote[featured]"]').input_value(),'0')
            self.assertEqual(set(methods), {'GET'})
            browser.close()

if __name__=='__main__':unittest.main()
