"""Read-only PHP directory search; exact-destination detail candidates require verification."""
from urllib.parse import urlencode

from .common import go


def directory_candidates(browser, business, host):
    ctx = browser.new_context()
    try:
        page = ctx.new_page()
        go(page, 'https://' + host + '/index.php?' + urlencode({'q': business['name']}))
        return page.evaluate('''({target,host,name}) => {
          const norm = value => {const u=new URL(value,location.href);return u.origin.toLowerCase()+u.pathname.replace(/\\/$/,'')+u.search;};
          const result=[];
          for(const a of document.querySelectorAll('a[href][id]')) {
            const id=a.id.startsWith('id_')?a.id.slice(3):a.id;
            if(!id || [...id].some(c=>c<'0'||c>'9'))continue;
            try {if(norm(a.href)!==norm(target))continue;}catch{continue;}
            const row=a.closest('tr');
            if(!row)continue;
            const before=result.length;
            for(const detail of row.querySelectorAll('a[href]')) {
              try {
                const u=new URL(detail.href,location.href);
                if(['http:','https:'].includes(u.protocol) && u.hostname.toLowerCase().replace(/^www\\./,'')===host &&
                   !u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname.endsWith('_'+id+'.html'))
                  result.push({url:u.href,id:Number(id)});
              }catch{}
            }
            // Some native templates omit the detail anchor but retain the public listing ID.
            // This is only a candidate: the caller independently verifies the actual page.
            if(result.length===before) {
              const slug=name.replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'');
              if(slug)result.push({url:new URL('/'+slug+'_'+id+'.html',location.href).href,id:Number(id)});
            }
          }
          return [...new Set(result.sort((a,b)=>b.id-a.id).map(x=>x.url))];
        }''', {'target': business['website'], 'host': host, 'name': business['name']})
    finally:
        ctx.close()
