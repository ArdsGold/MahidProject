function (input) {
  // HTML maxlength uses UTF-16 units, as does JavaScript string.length.
  const limit = Number.isInteger(input.limit) && input.limit >= 0 ? input.limit : Infinity;
  const omitted = [...(input.omitted_fields || [])];
  const included = [];
  for (const part of input.parts) {
    const room = limit - included.join('\n\n').length - (included.length ? 2 : 0);
    if (part.text.length <= room) included.push(part.text);
    else if (part.key === 'description' && room >= 24) {
      // Only approved prose may be shortened. URLs and contact values stay whole.
      const prefix = part.text.slice(0, room - 1).replace(/[\uD800-\uDBFF]$/, '').replace(/\s+\S*$/, '').trimEnd();
      if (prefix) included.push(prefix + '…');
      omitted.push('description (shortened)');
    } else omitted.push(part.key + ' (character limit)');
  }
  const blocked = ['name', 'website'].some(key =>
    !input.parts.some(p => p.key === key) || omitted.some(v => v.startsWith(key + ' (')));
  return {text: included.join('\n\n'), omitted_fields: omitted, blocked,
    content_notes: Number.isFinite(limit) ? 'Combined text limit: ' + limit + ' UTF-16 units' : 'No declared text limit'};
}
