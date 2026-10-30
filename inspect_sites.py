"""Read-only discovery; never logs workbook credentials or submits forms."""
import concurrent.futures
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

import openpyxl


class Forms(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms = []
        self.links = []
        self.fields = []
        self.title = ''
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'title':
            self.in_title = True
        if tag == 'form':
            self.forms.append({k: a.get(k, '') for k in ('action', 'method', 'id')})
        if tag in ('input', 'textarea', 'select', 'button'):
            self.fields.append({k: a.get(k, '') for k in ('name', 'id', 'type', 'placeholder')})
        if tag == 'a' and any(t in a.get('href', '').lower() for t in ('submit', 'add', 'register', 'login', 'sign', 'create', 'post')):
            self.links.append(a.get('href'))

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, text):
        if self.in_title:
            self.title += text


def inspect(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=18) as r:
            data = r.read(700_000).decode('utf-8', errors='replace')
            p = Forms()
            p.feed(data)
            return {'url': url, 'final_url': r.url, 'status': r.status, 'title': p.title.strip(), 'forms': p.forms, 'fields': p.fields, 'links': list(dict.fromkeys(p.links))[:35], 'captcha': any(s in data.lower() for s in ('g-recaptcha', 'hcaptcha', 'cf-turnstile', 'cf-chl-'))}
    except Exception as e:
        return {'url': url, 'error': str(e)}


if __name__ == '__main__':
    if sys.argv[1].lower().endswith('.xlsx'):
        from backlinks import load_workbook
        _, entries = load_workbook(sys.argv[1])
        urls = list(dict.fromkeys('https://' + e['domain'] for e in entries))
    else:
        urls = sys.argv[1:]
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(inspect, urls))
    Path('.local').mkdir(exist_ok=True)
    Path('.local/discovery.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    for r in results:
        title = r.get('title', '')[:75].encode('ascii', errors='backslashreplace').decode('ascii')
        print(r['url'], r.get('status', r.get('error')), title, 'captcha' if r.get('captcha') else '')
