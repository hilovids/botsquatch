const BADGE_IDS = {
  moth: 'moth',
  iguana: 'iguana',
  wolf: 'wolf',
  ferret: 'ferret',
  umarble: 'umarble',
  thief: 'thief',
  nothing: 'nothing',
  curse: 'curse',
  cyclone: 'cyclone',
  volcano: 'volcano',
  wind: 'wind',
  waves: 'waves',
  flames: 'flames',
  stone: 'stone',
  winner: 'winner',
  fishing: 'fishing',
  star: 'star',
  light: 'light',
  darkness: 'darkness',
  hacker: 'hacker',
};

const BADGE_ALIASES = {
  moth: BADGE_IDS.moth,
  'moth badge': BADGE_IDS.moth,
  iguana: BADGE_IDS.iguana,
  'iguana badge': BADGE_IDS.iguana,
  wolf: BADGE_IDS.wolf,
  'wolf badge': BADGE_IDS.wolf,
  ferret: BADGE_IDS.ferret,
  'ferret badge': BADGE_IDS.ferret,
  umarble: BADGE_IDS.umarble,
  'umarble badge': BADGE_IDS.umarble,
  thief: BADGE_IDS.thief,
  'thief badge': BADGE_IDS.thief,
  nothing: BADGE_IDS.nothing,
  'nothing badge': BADGE_IDS.nothing,
  curse: BADGE_IDS.curse,
  'curse badge': BADGE_IDS.curse,
  cyclone: BADGE_IDS.cyclone,
  'cyclone badge': BADGE_IDS.cyclone,
  volcano: BADGE_IDS.volcano,
  'volcano badge': BADGE_IDS.volcano,
  wind: BADGE_IDS.wind,
  'wind badge': BADGE_IDS.wind,
  waves: BADGE_IDS.waves,
  wave: BADGE_IDS.waves,
  'waves badge': BADGE_IDS.waves,
  flames: BADGE_IDS.flames,
  flame: BADGE_IDS.flames,
  'flames badge': BADGE_IDS.flames,
  stone: BADGE_IDS.stone,
  'stone badge': BADGE_IDS.stone,
  winner: BADGE_IDS.winner,
  'winner badge': BADGE_IDS.winner,
  fishing: BADGE_IDS.fishing,
  'fishing badge': BADGE_IDS.fishing,
  star: BADGE_IDS.star,
  stars: BADGE_IDS.star,
  'star badge': BADGE_IDS.star,
  light: BADGE_IDS.light,
  'light badge': BADGE_IDS.light,
  darkness: BADGE_IDS.darkness,
  'darkness badge': BADGE_IDS.darkness,
  hacker: BADGE_IDS.hacker,
  'hacker badge': BADGE_IDS.hacker,
};

function normalizeBadgeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeBadgeId(input) {
  return BADGE_ALIASES[normalizeBadgeKey(input)] || null;
}

function splitBadges(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v || '').trim()).filter(Boolean);
  return String(raw)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveBadges(input) {
  const rawBadges = splitBadges(input);
  const normalized = rawBadges
    .map((value) => ({ input: value, normalized: normalizeBadgeId(value) }))
    .filter((item) => !!item.normalized);

  const invalid = rawBadges.filter((value) => !normalizeBadgeId(value));
  const badgeSet = [...new Set(normalized.map((item) => item.normalized))];

  return { rawBadges, normalized, invalid, badgeSet };
}

async function listBadges(collection, userQuery) {
  const userDoc = await collection.findOne(userQuery, { projection: { badges: 1 } });
  if (!userDoc) {
    return { ok: false, matchedCount: 0, badges: [] };
  }
  const badges = Array.isArray(userDoc.badges) ? userDoc.badges : [];
  return { ok: true, matchedCount: 1, badges };
}

async function addBadges(collection, userQuery, badgeInput) {
  const { invalid, badgeSet } = resolveBadges(badgeInput);
  if (!badgeSet.length) {
    return { ok: false, reason: 'no-valid-badges', appliedBadges: [], invalidBadges: invalid, matchedCount: 0, modified: 0, badges: [] };
  }

  const result = await collection.updateOne(userQuery, { $addToSet: { badges: { $each: badgeSet } } });
  if (!result.matchedCount) {
    return { ok: false, reason: 'user-not-found', appliedBadges: badgeSet, invalidBadges: invalid, matchedCount: 0, modified: 0, badges: [] };
  }

  const current = await listBadges(collection, userQuery);
  return {
    ok: true,
    appliedBadges: badgeSet,
    invalidBadges: invalid,
    matchedCount: result.matchedCount,
    modified: result.modifiedCount,
    badges: current.badges,
  };
}

async function removeBadges(collection, userQuery, badgeInput) {
  const { invalid, badgeSet } = resolveBadges(badgeInput);
  if (!badgeSet.length) {
    return { ok: false, reason: 'no-valid-badges', appliedBadges: [], invalidBadges: invalid, matchedCount: 0, modified: 0, badges: [] };
  }

  const result = await collection.updateOne(userQuery, { $pull: { badges: { $in: badgeSet } } });
  if (!result.matchedCount) {
    return { ok: false, reason: 'user-not-found', appliedBadges: badgeSet, invalidBadges: invalid, matchedCount: 0, modified: 0, badges: [] };
  }

  const current = await listBadges(collection, userQuery);
  return {
    ok: true,
    appliedBadges: badgeSet,
    invalidBadges: invalid,
    matchedCount: result.matchedCount,
    modified: result.modifiedCount,
    badges: current.badges,
  };
}

module.exports = {
  BADGE_IDS,
  BADGE_ALIASES,
  normalizeBadgeId,
  splitBadges,
  resolveBadges,
  listBadges,
  addBadges,
  removeBadges,
};
