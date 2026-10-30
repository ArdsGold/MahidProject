// Explicit editor target only. No editor discovery, navigation or publication.
(async function ({selector, html}) {
  const fields = document.querySelectorAll(selector);
  const fail = reason => ({ok: false, reason});
  if (fields.length !== 1) return fail('Missing or ambiguous approved editor target');
  const field = fields[0], id = field.id;
  const tiny = id && window.tinymce && window.tinymce.get(id);
  const ck = id && window.CKEDITOR && window.CKEDITOR.instances && window.CKEDITOR.instances[id];
  if (tiny && ck) return fail('Ambiguous editor API for approved target');
  if (tiny) {
    tiny.setContent(html);
    tiny.fire('change'); tiny.fire('input'); tiny.save();
  } else if (ck) {
    // CKEditor updates asynchronously; mirror the backing field after its callback.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Editor synchronization timed out')), 3000);
      ck.setData(html, {callback: () => { clearTimeout(timer); resolve(); }});
    });
    ck.updateElement(); ck.fire('change');
  } else return fail('No supported editor API bound to the approved target');
  const actual = tiny ? tiny.getContent() : ck.getData();
  const material = value => {
    const template = document.createElement('template'); template.innerHTML = value;
    return {text: template.content.textContent.replace(/\s+/g, ' ').trim(),
      links: [...template.content.querySelectorAll('a[href]')].map(a => [a.textContent, a.getAttribute('href')])};
  };
  const expected = JSON.stringify(material(html));
  if (JSON.stringify(material(actual)) !== expected || JSON.stringify(material('value' in field ? field.value : field.innerHTML)) !== expected) {
    return fail('Editor did not retain the approved text and hyperlinks in its backing field');
  }
  return {ok: true, editor: tiny ? 'tinymce' : 'ckeditor'};
})
