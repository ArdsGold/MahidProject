"""Playwright form mappings; final submission stays in the publisher."""
import re
from urllib.parse import urlsplit, parse_qs, urlencode

from .registry import CLASSIFIEDS, DIRECTORIES, US_STATES
from .directories import DIRECTORY_SITES, DIRECTORY_INSPECTOR, submission_url
from .categories import category_choice
from .classified_routes import category_route, location as classified_location
from .category_records import observe_route
from .common import NeedsAttention, domain, fit_body, go, wait_for_challenge
from operator_notifications import check_cancelled


def prepare(page, host, b, entry, record, interactive):
    if host in CLASSIFIEDS:
        place = classified_location(b)
        route = category_route(b)
        if not place or not b.get('email'):
            raise NeedsAttention('Classifieds workflow needs a recognized US location and public business email')
        if not route:
            raise NeedsAttention('Classifieds category route needs mapping for this business type')
        city, state = place
        go(page, 'https://' + host + '/index.php?view=post&cityid=0&lang=en')
        location = page.get_by_role('link', name=state, exact=True)
        if location.count() != 1:
            raise NeedsAttention('No unique matching state on this classifieds site')
        location.click()
        steps = []
        for label in route['labels']:
            options = page.locator('a[href]').evaluate_all("els=>els.filter(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&u.searchParams.get('view')==='post'&&!!u.searchParams.get('catid')&&[...u.searchParams.keys()].every(k=>['view','postevent','cityid','lang','catid','subcatid','shortcutregion'].includes(k));}catch{return false;}}).map(a=>({label:a.textContent.trim(),value:a.href}))")
            matches = [o for o in options if o['label'] == label]
            steps.append({'options': options, 'selected': matches[0] if len(matches)==1 else None})
            observe_route(host,b,steps,route)
            if len(matches)!=1:
                raise NeedsAttention('Classifieds category route changed; complete category inventory saved for review')
            check_cancelled()
            page.get_by_role('link',name=label,exact=True).click()
        record['selected_category'] = {'label':' > '.join(route['labels']),'value':steps[-1]['selected']['value'],'reason':route['reason']}
        record['category_options_path'] = 'mappings/category_routes/' + host + '.json'
        page.wait_for_load_state('domcontentloaded')
        query = parse_qs(urlsplit(page.url).query)
        record['category_url'] = 'https://' + host + '/index.php?' + urlencode({'view': 'ads', **{key: query[key][0] for key in ('cityid', 'catid', 'subcatid') if key in query}})
        page.locator('#adtitle').fill(b['name'])
        fit_body(page, '[name="addesc"]', b, record, markdown=True)
        page.locator('#email').fill(b.get('email', ''))
        locations = page.locator('[name="arealist"] option').evaluate_all('(els)=>els.map(e=>({label:e.textContent.trim(),value:e.value}))')
        normalize = lambda value: re.sub('[^a-z0-9]', '', value.lower()).replace('saint', 'st')
        chosen = next((o for o in locations if normalize(o['label']) == normalize(city)), None)
        if chosen:
            page.locator('[name="arealist"]').select_option(chosen['value'])
        else:
            page.locator('[name="area"]').fill(city)
        # Explicitly choose the free options; no featured or extended purchase.
        for name in ('promote[featured]', 'promote[extended]'):
            page.locator('[name="' + name + '"]').select_option(label='None')
        page.locator('[name="agree"]').check()
        wait_for_challenge(page, interactive)
        expected = parse_qs(urlsplit(steps[-1]['selected']['value']).query)
        current = parse_qs(urlsplit(page.url).query)
        if domain(page.url) != host or any(expected.get(k) != current.get(k) for k in ('cityid','catid','subcatid')):
            raise NeedsAttention('Selected classifieds category changed; no submission made')
        return 'button[type="submit"]:has-text("Post Now")', None
    if host == 'ikeanded.com':
        if not entry['login_email'] or not entry['password']:
            raise NeedsAttention('Workbook login email/password missing')
        go(page, 'https://www.ikeanded.com/directory/login.aspx')
        if domain(page.url) != host:
            raise NeedsAttention('Login redirected outside expected domain')
        page.locator('#PageContent_LoginForm1_Email').fill(entry['login_email'])
        page.locator('#PageContent_LoginForm1_Password').fill(entry['password'])
        wait_for_challenge(page, interactive)
        check_cancelled()
        page.locator('#PageContent_LoginForm1_Login').click()
        page.wait_for_url('**/myaccount.aspx')
        go(page, 'https://www.ikeanded.com/directory/myaccountlistings.aspx')
        record['existing_listing_urls'] = page.locator('a[href*="listingdisplay.aspx?lid="]').evaluate_all('(els)=>els.map(e=>e.href)')
        go(page, 'https://www.ikeanded.com/directory/listingedit.aspx')
        free = page.get_by_text('Basic 5 Day Listing', exact=True).locator('..').locator('..')
        if not re.search(r'\bFREE\b', free.inner_text()):
            raise NeedsAttention('Free listing plan no longer available')
        free.get_by_role('link', name='Select Plan', exact=True).click()
        prefix = '#PageContent_Listing_'
        page.locator(prefix + 'Title').wait_for(state='visible')
        short = b.get('short_description') or re.split(r'(?<=[.!?])\s+', b['description'])[0]
        if len(short) > 160:
            short = short[:160].rsplit(' ', 1)[0]
        for field, value in {'Title': b['name'], 'OrgName': b['name'], 'Description': b['description'], 'ShortDescription': short,
                             'Phone': b.get('phone', ''), 'Email': b.get('email', ''), 'URL': b['website']}.items():
            control = page.locator(prefix + field)
            if control.is_visible():
                if field == 'Description':
                    fit_body(page, prefix + field, b, record)
                else:
                    control.fill(value)
        category = page.locator(prefix + 'CatId')
        options = category.locator('option').evaluate_all('(els)=>els.map(e=>({label:e.textContent.trim(),value:e.value,disabled:e.disabled||!!e.closest("optgroup[disabled]")}))')
        match = category_choice(page, options, b)
        if not match:
            raise NeedsAttention('Directory category needs mapping for this business')
        category.select_option(match['value'])
        address = re.fullmatch(r'(.+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?),\s*(?:United States|USA|US)', b.get('address', ''))
        if not address:
            raise NeedsAttention('This directory workflow needs a US street, city, state and ZIP address')
        street, city, region, postal = address.groups()
        ap = prefix + 'ListingEditAddress__'
        for field, value in [('Country', 'US'), ('State', region)]:
            control = page.locator(ap + field)
            if control.input_value() != value:
                with page.expect_navigation(wait_until='domcontentloaded'):
                    control.select_option(value)
        page.locator(ap + 'Address1').fill(street)
        page.locator(ap + 'PostalCode').fill(postal)
        city_select = page.locator(ap + 'City_CityDropDownList')
        normalize = lambda v: re.sub(r'[^a-z0-9]', '', v.lower()).replace('saint', 'st')
        cities = city_select.locator('option').evaluate_all('(els)=>els.map(e=>({text:e.textContent,value:e.value}))')
        choices = [c for c in cities if normalize(c['text']) == normalize(city)]
        if len(choices) != 1:
            raise NeedsAttention('Directory city dropdown needs mapping')
        city_select.select_option(choices[0]['value'])
        page.wait_for_load_state('domcontentloaded')
        if not page.evaluate('typeof Page_ClientValidate === "undefined" || Page_ClientValidate()'):
            raise NeedsAttention('Directory form validation failed; required fields need checking')
        wait_for_challenge(page, interactive)
        return prefix + 'RunButton', None
    if host in ('postheaven.net', 'writeablog.net'):
        if not entry['username'] or not entry['password']:
            raise NeedsAttention('Workbook login credentials are missing')
        go(page, 'https://' + host + '/login')
        if domain(page.url) != host:
            raise NeedsAttention('Login redirected outside the expected domain')
        username, password, submit = ('#username-input', '#password-input', '#btn-login') if host == 'writeablog.net' else ('#username', '#user_password', '#commit')
        page.locator(username).fill(entry['username'])
        page.locator(password).fill(entry['password'])
        wait_for_challenge(page, interactive)
        check_cancelled()
        page.locator(submit).click()
        page.locator('#writer').wait_for(state='visible')
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_function('typeof H !== "undefined" && typeof publishing !== "undefined"')
        if host == 'writeablog.net' and page.locator('#writer').input_value().strip():
            raise NeedsAttention('Existing editor draft needs review before preparing a new post')
        page.locator('#publish-to').click()
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', entry['username']):
            raise NeedsAttention('Unexpected blog alias; configure this account manually')
        blog = page.locator('a[href="#' + entry['username'] + '"]')
        if blog.count() != 1:
            raise NeedsAttention('No existing public blog matching the workbook username')
        blog.click()
        if page.evaluate('H.get("postTarget", "anonymous")') != entry['username']:
            raise NeedsAttention('Public blog selection did not take effect')
        fit_body(page, '#writer', b, record, markdown=True)
        wait_for_challenge(page, interactive)
        return '#publish', None
    if host == 'justpaste.it':
        go(page, 'https://justpaste.it/')
        page.wait_for_function('window.tinymce && tinymce.get("tinyMCEEditor")', timeout=20000)
        fit_body(page, '#tinyMCEEditor', b, record, rich=True)
        wait_for_challenge(page, interactive)
        return 'button.publishButton', None
    if host == 'rentry.co':
        go(page, 'https://rentry.co/')
        fit_body(page, '#id_text', b, record, markdown=True)
        page.locator('#id_url').fill(record['slug'])
        page.locator('#id_edit_code').fill(record['edit_code'])
        wait_for_challenge(page, interactive)
        return '#submitButton', 'https://rentry.co/' + record['slug']
    if host == 'padzee.com':
        go(page, 'https://padzee.com/')
        fit_body(page, '#code', b, record)
        page.locator('#txtUrl').fill(record['slug'])
        # No viewer password: only publicly accessible pages can be counted.
        agree = page.locator('#agree')
        if agree.count() and agree.is_visible():
            agree.check()
        wait_for_challenge(page, interactive)
        return '#main-form input[type="submit"]', 'https://padzee.com/' + record['slug']
    if host == 'pastelink.net':
        go(page, 'https://pastelink.net/submit')
        page.locator('#input-title').fill(b['name'])
        fit_body(page, '#textbody', b, record)
        page.get_by_text('More Options', exact=True).click()
        page.locator('#custom_url').fill(record['slug'])
        page.locator('#passcode').fill(record['edit_code'])
        if not page.locator('#visibility-1').is_checked():
            page.locator('label[for="visibility-1"]').click()
        wait_for_challenge(page, interactive)
        return '#submitbtn', 'https://pastelink.net/' + record['slug']
    if host in DIRECTORIES:
        site = DIRECTORY_SITES.get(host)
        go(page, submission_url(site) if site else 'https://' + host + '/submit.php')
        if not interactive:
            wait_for_challenge(page, False)
        if site:
            inspected = page.evaluate(DIRECTORY_INSPECTOR, site)
            if not inspected['ok']:
                raise NeedsAttention(inspected['reason'])
            if site.get('manualRadio'):
                page.locator('[name="' + site['manualRadio']['name'] + '"][value="' + site['manualRadio']['value'] + '"]').check()
        for name, value in {'TITLE': b['name'], 'URL': b['website'], 'DESCRIPTION': b['description'],
                            'OWNER_NAME': b['name'], 'OWNER_EMAIL': b.get('email', '')}.items():
            if name == 'DESCRIPTION':
                fit_body(page, '[name="DESCRIPTION"]', b, record)
            else:
                page.locator('[name="' + name + '"]').fill(value)
        options = page.locator('[name="CATEGORY_ID"] option').evaluate_all('(els)=>els.map(e=>({label:e.textContent.trim(),value:e.value,disabled:e.disabled||!!e.closest("optgroup[disabled]")}))')
        choice = category_choice(page, options, b)
        if not choice:
            raise NeedsAttention('No matching category; site-specific category mapping required')
        page.locator('[name="CATEGORY_ID"]').select_option(choice['value'])
        if page.locator('[name="RECPR_URL"]').count() and not (site and site.get('optionalReciprocal')):
            raise NeedsAttention('Directory requests a reciprocal link; not supplied in workbook')
        agree = page.locator('[name="agree"]')
        if agree.count():
            agree.check()
        wait_for_challenge(page, interactive)
        return '[name="submit"][type="submit"]', None
    raise NeedsAttention('No tested publishing workflow for this platform; see audit.json')
