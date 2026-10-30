// Permit harmless editor HTML serialization while preserving approved text and exact links.
(function (j) {
  const fail = reason => ({ok: false, reason});
  const title = document.querySelector('[name="post_title"]'), body = document.querySelector('#content');
  if (!title || !body || title.value !== j.title) return fail('Approved post title changed');
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const expected = parse(j.html), actual = parse(body.value);
  if (actual.querySelector('script,iframe,object,embed,style,[hidden]') ||
      [...actual.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name)) ||
        /display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.getAttribute('style') || ''))) return fail('Unexpected active or hidden post content');
  const text = doc => {
    const parts = [];
    const walk = node => {
      if (node.nodeType === 3) parts.push(node.textContent);
      else {
        if (/^(P|DIV|H[1-6]|LI|UL|OL|BR)$/.test(node.nodeName)) parts.push(' ');
        node.childNodes.forEach(walk);
        if (/^(P|DIV|H[1-6]|LI|UL|OL)$/.test(node.nodeName)) parts.push(' ');
      }
    };
    walk(doc.body);
    return parts.join('').replace(/\s+/g, ' ').trim();
  };
  const links = doc => [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).sort();
  if (text(expected) !== text(actual) || JSON.stringify(links(expected)) !== JSON.stringify(links(actual))) return fail('Approved post text or links changed');
  if (!links(actual).includes(j.website)) return fail('Clickable official website missing');
  const visit = [...document.querySelectorAll('a[href]')].find(a => a.textContent.trim() === 'Visit Site');
  if (!visit || new URL(visit.href).hostname !== j.public_host) return fail('Public blog hostname changed');
  return {ok: true};
})
