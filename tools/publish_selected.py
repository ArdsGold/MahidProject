import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from backlinks import load_workbook,campaign_folder,campaign_lock,save
from website_pool import merge_pool,refresh_pool,progress_message
from uivision import UiVision
from uivision_publish import run_queue
from playwright.sync_api import sync_playwright
b,e=load_workbook('.local/workbooks/Cheer_Athletics_St_Louis.xlsx');e=merge_pool(e,'websites/Website_Pool.xlsx','.local/workbooks/Cheer_Athletics_St_Louis.xlsx');f=campaign_folder(b)
with campaign_lock(f/'.lock'):
 s=json.loads((f/'state.json').read_text(encoding='utf-8'))
 with UiVision() as c:
  c.call('select_browser',{'target':'chrome#1','why':'Continue authorized publishing on selected mapped directory in the existing automation tab'})
  with sync_playwright() as p:
   browser=p.chromium.launch()
   try:run_queue(c,browser,b,e,s,f,only=sys.argv[1:],all_sites=True)
   finally:browser.close();save(s,f,e)
 refresh_pool('websites/Website_Pool.xlsx',campaign=f)
 print(progress_message(s,100))
