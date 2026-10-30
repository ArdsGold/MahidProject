// Adapted from extSource matching.ts: rank actual enabled options using profile evidence.
// Require a clear match; category labels never supply invented option IDs.
(function ({options, business}) {
  const normalize = value => String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = value => new Set(normalize(value).split(' ').filter(word => word.length > 2 && word !== 'and'));
  const choices = options.filter(o => !o.disabled && String(o.value) !== '' && String(o.value) !== '0')
    .map(option => {
      const raw = String(option.label === undefined ? option.text : option.label);
      const prefix = (raw.match(/^[^a-z0-9]*/i) || [''])[0];
      return {option, label: normalize(raw), depth: (prefix.match(/\|/g) || []).length};
    });
  const unique = matches => {
    const shallowest = Math.min(...matches.map(o => o.depth));
    const preferred = matches.filter(o => o.depth === shallowest);
    return preferred.length === 1 ? preferred[0].option : null;
  };
  const category = normalize(business.category);
  const sportsCategory = /\b(sport|sports|cheer|cheerleading)\b/.test(category);
  const exact = choices.filter(o => category && o.label === category);
  if (exact.length) {
    const match = unique(exact);
    if (match || !sportsCategory) return match;
  }
  if (sportsCategory) {
    const labels = ['sports', 'sports and recreation', 'recreation and sports'];
    const general = choices.filter(o => labels.includes(o.label));
    const shallowest = Math.min(...general.map(o => o.depth));
    for (const label of labels) {
      const match = unique(general.filter(o => o.label === label && o.depth === shallowest));
      if (match) return match;
    }
  }
  const services = Array.isArray(business.services) ? business.services : String(business.services || '').split(/[,;\n]/);
  const desired = [business.category, ...services, business.description, business.short_description].filter(Boolean).map(words);
  const evidence = words([business.category, ...services, business.description, business.short_description].filter(Boolean).join(' '));
  const generic = new Set(['business', 'services', 'service', 'contractor', 'contractors']);
  const ranked = choices.map(choice => {
    const label = words(choice.label);
    // Additional restrictive terms (e.g. Animal Sports) require business evidence.
    if (!label.size || [...label].some(word => !evidence.has(word) && !generic.has(word))) return {...choice, score: 0};
    const score = Math.max(0, ...desired.map(target => [...target].filter(word => label.has(word)).length / Math.max(target.size, 1)));
    return {...choice, score};
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0], next = ranked[1];
  return best && best.score >= 0.5 && best.score - (next ? next.score : 0) >= 0.15 ? best.option : null;
})
