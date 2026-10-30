"""Read/export XLSX using only Python's standard library. Never writes the source."""
import sys, json, zipfile, hashlib, re, posixpath
from pathlib import Path
from urllib.parse import urlsplit
import xml.etree.ElementTree as E
from xml.sax.saxutils import escape

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def extract(source):
    with zipfile.ZipFile(source) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [''.join(t.text or '' for t in x.findall('.//m:t', NS)) for x in E.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        wb = E.fromstring(z.read('xl/workbook.xml'))
        rels = {x.attrib['Id']: x.attrib['Target'] for x in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        entries, ignored, identity = [], [], {}
        for sheet in wb.findall('m:sheets/m:sheet', NS):
            target = rels[sheet.attrib['{' + R + '}id']]
            path = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            root = E.fromstring(z.read(path))
            link_path = posixpath.dirname(path) + '/_rels/' + posixpath.basename(path) + '.rels'
            link_rels = {x.attrib['Id']: x.attrib['Target'] for x in E.fromstring(z.read(link_path)) if x.attrib.get('TargetMode') == 'External'} if link_path in z.namelist() else {}
            links = {x.attrib['ref']: link_rels.get(x.attrib.get('{' + R + '}id'), '') for x in root.findall('m:hyperlinks/m:hyperlink', NS) if re.fullmatch(r'B\d+', x.attrib['ref'])}
            for row in root.findall('m:sheetData/m:row', NS):
                number = int(row.attrib['r'])
                # Deliberately never inspect C or any account/credential cells.
                cells = {}
                for c in row:
                    col = re.sub(r'\d', '', c.attrib['r'])
                    if col not in ('A', 'B'): continue
                    v = c.find('m:v', NS)
                    cells[col] = shared[int(v.text)] if c.attrib.get('t') == 's' and v is not None else ''.join(t.text or '' for t in c.findall('.//m:t', NS)) if c.attrib.get('t') == 'inlineStr' else v.text if v is not None else ''
                value = cells.get('B', '').strip()
                navigation = value
                # Use the workbook's real hyperlink for a protocol-less display label.
                if not re.match(r'^https?://', navigation, re.I):
                    navigation = links.get('B' + str(number), '')
                if number < 17 and cells.get('A') and value:
                    identity[cells['A'].strip()] = value
                try:
                    u = urlsplit(navigation)
                    valid = u.scheme.lower() in ('http', 'https') and bool(u.hostname) and not u.username and not u.password and not re.search(r'\s', navigation)
                    if valid: u.port
                except ValueError: valid = False
                if valid:
                    entries.append({'sheet': sheet.attrib['name'], 'row': number, 'originalUrl': value, 'navigationUrl': navigation, 'referenceOnly': number < 17})
                elif value: ignored.append({'sheet': sheet.attrib['name'], 'row': number, 'reason': 'Column B is not an absolute HTTP(S) URL'})
    return {'source': str(Path(source).resolve()), 'sourceSha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(), 'identity': identity, 'entries': entries, 'ignoredCells': ignored, 'columnCUsed': False}

def column(n):
    out = ''
    while n:
        n, r = divmod(n-1, 26); out = chr(65+r)+out
    return out

HEADERS = [('row','Original Row'), ('originalUrl','Original Column B URL'), ('finalUrl','Final Destination URL'), ('httpStatus','HTTP Status'), ('classification','Classification'), ('reason','Exact Reason'), ('matchedDetails','Business Details Matched'), ('evidencePath','Evidence Path'), ('verifiedAt','Verification Timestamp UTC'), ('screenshot','Screenshot Reference'), ('title','Page Title'), ('errors','Errors'), ('attemptCount','Attempts'), ('sheet','Source Sheet')]

def worksheet(rows):
    xml = ['<worksheet xmlns="'+NS['m']+'"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>']
    for i, (key, _) in enumerate(HEADERS, 1):
        width = 11 if key in ('row','httpStatus','attemptCount') else 64 if key in ('originalUrl','finalUrl','reason','evidencePath') else 33
        xml.append(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>')
    xml.append('</cols><sheetData>')
    for n, record in enumerate([dict(HEADERS)]+rows, 1):
        style = 1 if n == 1 else {'VERIFIED_LIVE':2,'NOT_LIVE':3,'NEEDS_REVIEW':4}.get(record.get('classification'),0)
        xml.append(f'<row r="{n}" ht="55" customHeight="1">')
        for i, (key, _) in enumerate(HEADERS,1):
            value = record.get(key, '')
            if isinstance(value, (list,dict)): value = json.dumps(value, ensure_ascii=False)
            value = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', str(value if value is not None else ''))[:32767]
            xml.append(f'<c r="{column(i)}{n}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>')
        xml.append('</row>')
    xml.append(f'</sheetData><autoFilter ref="A1:N{len(rows)+1}"/></worksheet>')
    return ''.join(xml)

def export(report_path, output):
    report = json.loads(Path(report_path).read_text(encoding='utf-8'))
    inventory, rows = report['inventory'], report['results']
    expected = {(x['sheet'], x['row'], x['originalUrl']) for x in inventory['entries']}
    actual = [(x['sheet'], x['row'], x['originalUrl']) for x in rows]
    assert len(actual) == len(set(actual)) and set(actual) == expected, 'Audit must contain every input row exactly once'
    assert Path(output).resolve() != Path(inventory['source']).resolve(), 'Cannot overwrite source'
    assert hashlib.sha256(Path(inventory['source']).read_bytes()).hexdigest() == inventory['sourceSha256'], 'Source changed'
    groups = [('Remaining Sites', [r for r in rows if r['classification'] != 'VERIFIED_LIVE']), ('Verified Live Listings',[r for r in rows if r['classification'] == 'VERIFIED_LIVE']), ('Full Verification Audit',rows)]
    styles = '<styleSheet xmlns="'+NS['m']+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+''.join('<fill><patternFill patternType="solid"><fgColor rgb="'+c+'"/><bgColor indexed="64"/></patternFill></fill>' for c in ['FF243746','FFE2F0D9','FFFCE4D6','FFFFEB9C'])+'</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5">'+''.join(f'<xf numFmtId="0" fontId="{1 if i==1 else 0}" fillId="{i+1 if i else 0}" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' for i in range(5))+'</cellXfs></styleSheet>'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,4))+'</Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+R+'/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml','<workbook xmlns="'+NS['m']+'" xmlns:r="'+R+'"><sheets>'+''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i,(name,_) in enumerate(groups,1))+'</sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i}" Type="{R}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,4))+f'<Relationship Id="rId4" Type="{R}/styles" Target="styles.xml"/></Relationships>')
        z.writestr('xl/styles.xml',styles)
        for i,(_,records) in enumerate(groups,1): z.writestr(f'xl/worksheets/sheet{i}.xml',worksheet(records))
    with zipfile.ZipFile(output) as z:
        for name in z.namelist(): E.fromstring(z.read(name))
        assert len(E.fromstring(z.read('xl/worksheets/sheet3.xml')).findall('m:sheetData/m:row', NS))-1 == len(expected)
    print(json.dumps({'output':str(Path(output).resolve()), 'auditRows':len(rows), 'sourceUnchanged':True}))

def validate(report_path, workbook):
    report = json.loads(Path(report_path).read_text(encoding='utf-8'))
    fresh = extract(report['inventory']['source'])
    assert fresh['sourceSha256'] == report['inventory']['sourceSha256']
    expected = [(e['sheet'],str(e['row']),e['originalUrl']) for e in fresh['entries']]
    records = report['results']
    assert len(records) == len(expected) and all(r['attemptCount'] > 0 for r in records), 'Unattempted rows remain'
    assert len(set(expected)) == len(expected)
    actual = [(r['sheet'],str(r['row']),r['originalUrl']) for r in records]
    assert actual == expected, 'Report rows do not exactly match fresh source extraction'
    assert all(r['classification'] in ('VERIFIED_LIVE','NOT_LIVE','NEEDS_REVIEW') for r in records)
    screenshots, missing = 0, []
    for r in records:
        assert Path(r['evidencePath'],'observation.json').is_file(), f"Missing observation row {r['row']}"
        assert Path(r['evidencePath'],'visible-text.txt').is_file()
        if r.get('screenshot'):
            assert Path(r['screenshot']).is_file(); screenshots += 1
        else:
            o = json.loads(Path(r['evidencePath'],'observation.json').read_text(encoding='utf-8'))
            assert o.get('screenshotError'), f"Missing screenshot without reason row {r['row']}"
            missing.append(r['row'])
    with zipfile.ZipFile(workbook) as z:
        assert [s.attrib['name'] for s in E.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',NS)] == ['Remaining Sites','Verified Live Listings','Full Verification Audit']
        data = []
        for i in range(1,4):
            rows = E.fromstring(z.read(f'xl/worksheets/sheet{i}.xml')).findall('m:sheetData/m:row',NS)[1:]
            data.append([{re.sub(r'\d','',c.attrib['r']): ''.join(t.text or '' for t in c.findall('.//m:t',NS)) for c in row} for row in rows])
        assert [(r['N'],r['A'],r['B']) for r in data[2]] == expected, 'Workbook audit coverage mismatch'
        assert len(data[0])+len(data[1]) == len(expected)
        assert all(r['E']=='VERIFIED_LIVE' for r in data[1])
        assert all(r['E']!='VERIFIED_LIVE' for r in data[0])
        assert len(data[1]) == report['summary']['verifiedLive']
    print(json.dumps({'validation':'PASS','freshSourceRows':len(expected),'auditRows':len(data[2]),'eachSourceRowExactlyOnce':True,'allAttempted':True,'sourceUnchanged':True,'screenshots':screenshots,'screenshotUnavailableRows':missing}))

if __name__ == '__main__':
    if sys.argv[1] == 'extract':
        Path(sys.argv[3]).write_text(json.dumps(extract(sys.argv[2]),indent=2),encoding='utf-8')
    elif sys.argv[1] == 'export': export(sys.argv[2],sys.argv[3])
    elif sys.argv[1] == 'validate': validate(sys.argv[2],sys.argv[3])
