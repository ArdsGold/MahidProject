"""Approved HTML formatting and editor synchronization adapted from extSource."""
import html
import re
from pathlib import Path

from .common import NeedsAttention, content

EDITOR_WRITER = Path(__file__).with_name('rich_editor.js').read_text(encoding='utf-8')


def article_html(business, text=None):
    # Workbook description remains literal approved text, not executable HTML.
    paragraphs = re.split(r'\n\s*\n', (text if text is not None else content(business)[0]).replace('\r\n', '\n'))
    url = html.escape(business['website'], quote=True)
    values = []
    for paragraph in paragraphs:
        tag = 'h1' if paragraph == business['name'] else 'p'
        escaped = html.escape(paragraph).replace('\n', '<br>')
        if paragraph == 'Website: ' + business['website']:
            escaped = '<a href="' + url + '">Official website</a>'
        values.append('<' + tag + '>' + escaped + '</' + tag + '>')
    return ''.join(values)


def fill_rich_editor(page, selector, value):
    result = page.evaluate(EDITOR_WRITER, {'selector': selector, 'html': value})
    if not result['ok']:
        raise NeedsAttention(result['reason'])
