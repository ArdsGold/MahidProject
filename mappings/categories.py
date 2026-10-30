"""One category matcher shared by the two browser runners."""
from pathlib import Path

CATEGORY_MATCHER = Path(__file__).with_name('category_match.js').read_text(encoding='utf-8')


def category_choice(page, options, business):
    return page.evaluate(CATEGORY_MATCHER, {'options': options, 'business': business})
