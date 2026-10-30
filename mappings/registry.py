"""Domains covered by reusable form workflows and US state labels."""
from .directories import IMPORTED_DIRECTORIES, LIVE_DIRECTORIES

DIRECTORIES = {
    'efdir.com', 'relevantdirectories.com', 'ifidir.com', 'relevantdirectory.biz',
    'relateddirectory.org', 'link-boy.org', 'aurora-directory.com',
    'addgoodsites.com', 'unique-listing.com', 'smartdir.org',
    'expansiondirectory.com', 'fruity-directory.com', 'lemon-directory.com',
    'reddit-directory.com', 'bing-directory.com', 'fwebdirectory.com', 'backpagedir.com',
} | set(IMPORTED_DIRECTORIES) | set(LIVE_DIRECTORIES)
CLASSIFIEDS = {'foldads.com', 'letspostfree.com', 'getadsonline.com', 'postquickads.com', 'pclassified.com', 'freeadsonline.biz', 'ezclassifiedads.com', 'postsmartads.com', 'totalclassified.com', 'nextfreeads.com', 'comadz.com', 'postezads.com', 'ursads.com', 'eonlineads.com', 'classifiedonlineads.net', 'freeadshome.com', 'pixolinks.com', 'uycart.com', 'fdlclassifieds.com', 'instantadz.com', 'postherefree.com', 'freewebads.biz', 'freewebads.us', 'postezad.com', 'totads.com', 'mypetads.com', 'petadshub.com'}
US_STATES = dict(item.split('=', 1) for item in (
    'AL=Alabama|AK=Alaska|AZ=Arizona|AR=Arkansas|CA=California|CO=Colorado|CT=Connecticut|DE=Delaware|'
    'DC=District of Columbia|FL=Florida|GA=Georgia|HI=Hawaii|ID=Idaho|IL=Illinois|IN=Indiana|IA=Iowa|'
    'KS=Kansas|KY=Kentucky|LA=Louisiana|ME=Maine|MD=Maryland|MA=Massachusetts|MI=Michigan|MN=Minnesota|'
    'MS=Mississippi|MO=Missouri|MT=Montana|NE=Nebraska|NV=Nevada|NH=New Hampshire|NJ=New Jersey|'
    'NM=New Mexico|NY=New York|NC=North Carolina|ND=North Dakota|OH=Ohio|OK=Oklahoma|OR=Oregon|'
    'PA=Pennsylvania|RI=Rhode Island|SC=South Carolina|SD=South Dakota|TN=Tennessee|TX=Texas|UT=Utah|'
    'VT=Vermont|VA=Virginia|WA=Washington|WV=West Virginia|WI=Wisconsin|WY=Wyoming'
).split('|'))
SUPPORTED = DIRECTORIES | CLASSIFIEDS | {'rentry.co', 'padzee.com', 'pastelink.net', 'justpaste.it', 'postheaven.net', 'writeablog.net', 'ikeanded.com', 'telegra.ph'}
