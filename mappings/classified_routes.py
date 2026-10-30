"""Business-topic routes for observed classifieds templates; validate every live link."""
import re
from .registry import US_STATES

ROUTES = (
    (r'\b(auto|automotive|battery|batteries|roadside|car|vehicle|vehicles|motoring)\b',
     ['Services', 'Motors'], 'Automotive and roadside services fit Services > Motors; live route confirmed on getadsonline.com'),
    (r'\b(sport|sports|cheer|cheerleading|fitness|gym|gymnastics|yoga)\b',
     ['Services', 'Health & Fitness'], 'Sports and fitness services fit the previously validated Health & Fitness route'),
)


def category_route(business):
    fallbacks=business.get('category_fallbacks') or []
    if isinstance(fallbacks,str):fallbacks=re.split(r'[;\n]',fallbacks)
    for category in [business.get('category',''),*fallbacks]:
        for pattern,labels,reason in ROUTES:
            if re.search(pattern,str(category),re.I):
                return {'labels':labels,'reason':reason}
    return None


def location(business):
    country=business.get('country','').strip().lower()
    if country and country not in ('us','usa','united states','united states of america'):
        return None
    city,region=business.get('city','').strip(),business.get('region','').strip().upper()
    if not city or region not in US_STATES:
        match=re.fullmatch(r'(.+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)(?:,\s*(?:United States|USA|US))?',business.get('address',''))
        if not match:return None
        _,city,region,_=match.groups()
    return (city,US_STATES[region]) if city and region in US_STATES else None
