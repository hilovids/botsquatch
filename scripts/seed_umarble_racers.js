#!/usr/bin/env node
// Seed script to populate the `umarble_racers` collection.
// Usage:
//   node scripts/seed_umarble_racers.js           # insert many documents
//   node scripts/seed_umarble_racers.js --drop    # clear collection then insert
//   node scripts/seed_umarble_racers.js --upsert  # upsert by name instead of insertMany

const { connectToMongo } = require('../utils/mongodbUtil');

const COLOR_PALETTE_32 = [
  '#000000', '#FFFFFF', '#E6194B', '#3CB44B', '#FFE119', '#0082C8', '#F58231', '#911EB4',
  '#46F0F0', '#F032E6', '#D2F53C', '#FABEBE', '#008080', '#E6BEFF', '#AA6E28', '#FFFAC8',
  '#800000', '#AAFFC3', '#808000', '#FFD8B1', '#000080', '#808080', '#A9A9A9', '#70DBDB',
  '#FFB3BA', '#B28DFF', '#BFFCC6', '#FFDFBA', '#FF9AA2', '#C7CEEA', '#84B6F4', '#B5EAD7'
];

const SKILL_CODE_MAP = {
  SPD: 'speedBurst',
  DBF: 'debuff',
  STA: 'staminaBuff'
};

const TIMING_CODE_MAP = {
  E: 0.33,
  M: 0.5,
  L: 0.67
};

function tryLoadSampleRacers() {
  return [
    { name: 'LeshawnaBall', stats: '077205Dbf-E' },
    { name: 'Methodical Monarch', stats: '176304Dbf-L' },
    { name: 'Manhattan Cafe', stats: '370605Spd-M' },
    { name: 'Iron Lung', stats: '370704Spd-L' },
    { name: 'Bad Tree', stats: '635142Dbf-M' },
    { name: 'The Dark Marbler', stats: '185242Dbf-M' },
    { name: 'Discover the Gold', stats: '255603Spd-M' },
    { name: 'Azure Comet', stats: '193514Spd-E' },
    { name: 'The Red Rocket', stats: '097007Spd-E' },
    { name: 'HSM1TTY', stats: '234156Dbf-M' },
    { name: 'Icon Comet', stats: '354027Sta-M' },
    { name: 'Idolize Fields', stats: '074703Spd-M' },
    { name: 'Egg', stats: '070707Spd-M' },
    { name: 'Winter Orb', stats: '175224Spd-M' },
    { name: 'Flowarble', stats: '171237Sta-M' },
    { name: 'La Cucuracha', stats: '077007Spd-M' },
    { name: 'Mega River', stats: '146406Sta-M' },
    { name: 'Marble Typhoon', stats: '271605Spd-M' },
    { name: 'Queen\'s Bistro', stats: '272416Dbf-M' },
    { name: 'Rilgar!', stats: '073713Spd-E' },
    { name: 'Starfox 64', stats: '087205Spd-E' },
    { name: 'I\'m 40% Dolomite', stats: '332373Spd-M' },
    { name: 'The Bee\'s Knees', stats: '170706Spd-M' },
    { name: 'Tour De Toise', stats: '228614Dbf-M' },
    { name: 'Bob\'s Legacy', stats: '471414Spd-M' },
    { name: 'Marble 5', stats: '076107Spd-L' },
  ];
}

function parseCompactStats(statsString) {
  if (typeof statsString !== 'string') return null;
  const trimmed = statsString.trim();
  const match = trimmed.match(/^(\d{6})(Spd|Dbf|Sta)-([EML])$/i);
  if (!match) return null;

  const digits = match[1];
  const skillCode = match[2].toUpperCase();
  const timingCode = match[3].toUpperCase();

  const stats = {
    Mind: Number(digits[0]),
    Agility: Number(digits[1]),
    Resolve: Number(digits[2]),
    Brawn: Number(digits[3]),
    Luck: Number(digits[4]),
    Endurance: Number(digits[5])
  };

  const skillKey = SKILL_CODE_MAP[skillCode];
  const skills = skillKey ? { [skillKey]: true } : {};
  const skillTiming = TIMING_CODE_MAP[timingCode] ?? 0.5;

  return { stats, skills, skillTiming };
}

function normalizeRacer(raw) {
  if (!raw || typeof raw !== 'object' || !raw.name) {
    throw new Error('Each racer must be an object with at least a name');
  }

  const compactParsed = parseCompactStats(raw.stats);
  const stats = compactParsed ? compactParsed.stats : (raw.stats || {});
  const skills = compactParsed ? compactParsed.skills : (raw.skills || {});
  const skillTiming = compactParsed ? compactParsed.skillTiming : ((typeof raw.skillTiming === 'number') ? raw.skillTiming : 0.5);

  const isDarkMarbler = String(raw.name).toLowerCase() === 'the dark marbler';
  const colorPool = isDarkMarbler
    ? ['#000000']
    : COLOR_PALETTE_32.filter(c => c.toUpperCase() !== '#000000');
  const color = colorPool[Math.floor(Math.random() * colorPool.length)];

  return {
    name: raw.name,
    stats,
    skills,
    skillTiming,
    color,
    createdAt: new Date()
  };
}

async function main() {
  const sampleRacers = tryLoadSampleRacers();
  const args = process.argv.slice(2);
  const doDrop = args.includes('--drop');
  const doUpsert = args.includes('--upsert');

  const db = await connectToMongo('hilovidsSiteData');
  const coll = db.collection('umarble_racers');

  if (doDrop) {
    console.log('Dropping existing documents in umarble_racers...');
    await coll.deleteMany({});
  }

  if (doUpsert) {
    console.log('Upserting sample racers by name...');
    const ops = sampleRacers.map(r => {
      const doc = normalizeRacer(r);
      return { updateOne: { filter: { name: r.name }, update: { $set: doc }, upsert: true } };
    });
    const res = await coll.bulkWrite(ops, { ordered: false });
    console.log('Upsert complete. Matched:', res.matchedCount, 'Upserted:', res.upsertedCount);
    return;
  }

  // Default insertMany flow
  const docs = sampleRacers.map(normalizeRacer);
  try {
    const res = await coll.insertMany(docs, { ordered: false });
    console.log(`Inserted ${res.insertedCount} racers into umarble_racers`);
  } catch (err) {
    // if some inserts fail due to duplicates, report summary
    if (err && err.result && err.result.result) {
      const inserted = (err.result.result.insertedCount) || 0;
      console.warn(`Partial insert: ${inserted} inserted before error`);
    }
    console.error('Insert error:', err.message || err);
  }
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err); process.exitCode = 2; });
}

module.exports = { main };
