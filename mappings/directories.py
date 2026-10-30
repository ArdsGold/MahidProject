"""Directory contracts from extSource and live inspections; no external source code is executed."""
import json
from pathlib import Path
from urllib.parse import urljoin

_FOLDER = Path(__file__).resolve().parent
IMPORTED_DIRECTORIES = json.loads((_FOLDER / 'imported_directories.json').read_text(encoding='utf-8'))
DIRECTORY_INSPECTOR = (_FOLDER / 'native_directory.js').read_text(encoding='utf-8')
LIVE_DIRECTORIES = {
    host: {'domain': host, 'startingUrl': 'https://' + host + '/',
           'protocols': ['https:'], 'submitValue': 'Continue',
           'optionalReciprocal': reciprocal,
           'inspected_date': '2026-10-23', 'fixture': 'mappings/fixtures/' + host + '.html'}
    for host, reciprocal in (
        ('prolink-directory.com', False), ('populardirectory.org', False), ('directorydirect.net', False),
        ('blackandbluedirectory.com', True), ('blackgreendirectory.com', True),
        ('bluesparkledirectory.com', True), ('brownedgedirectory.com', True),
        ('alive2directory.com', True), ('arcticdirectory.com', True), ('azure-directory.com', True),
        ('alivelink.org', False), ('trafficdirectory.org', False),
        ('royaldirectory.biz', False), ('directory8.org', True),
        ('directory10.org', False), ('directory9.biz', False),
    )
}
LIVE_DIRECTORIES.update(json.loads((_FOLDER / 'confirmed_directories.json').read_text(encoding='utf-8')))
# Live mappings retain their layout evidence; extSource imports retain separate provenance.
DIRECTORY_SITES = {**IMPORTED_DIRECTORIES, **LIVE_DIRECTORIES, 'lemon-directory.com': {
    'domain': 'lemon-directory.com', 'startingUrl': 'https://lemon-directory.com/',
    'protocols': ['https:'], 'submitValue': 'Submit', 'optionalReciprocal': True,
}}


def submission_url(site):
    return urljoin(site['startingUrl'], '/submit.php')
