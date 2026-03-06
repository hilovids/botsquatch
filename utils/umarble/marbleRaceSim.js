const { connectToMongo, getDb } = require('../mongodbUtil');
const { runRaceSimulation } = require('./raceSimulator');

function normalizeStats(stats = {}) {
  return {
    Agility: Number(stats.Agility || 0),
    Brawn: Number(stats.Brawn || 0),
    Endurance: Number(stats.Endurance || 0),
    Mind: Number(stats.Mind || 0),
    Luck: Number(stats.Luck || 0),
    Resolve: Number(stats.Resolve || 0)
  };
}

function normalizeRacer(doc = {}) {
  return {
    name: doc.name || 'Unknown Racer',
    stats: normalizeStats(doc.stats || doc),
    skills: doc.skills || {},
    skillTiming: (typeof doc.skillTiming === 'number') ? doc.skillTiming : 0.5,
    color: doc.color
  };
}

async function fetchRacers(db) {
  const coll = db.collection('umarble_racers');
  const docs = await coll.find({}).toArray();
  return docs.map(normalizeRacer);
}

async function fetchLatestRace(db) {
  const coll = db.collection('umarble_races');
  return coll.findOne({}, { sort: { createdAt: -1 } });
}

async function runMarbleRace(options = {}) {
  await connectToMongo(options.dbName || 'hilovidsSiteData');
  const db = getDb();

  const [racers, raceDoc] = await Promise.all([
    fetchRacers(db),
    fetchLatestRace(db)
  ]);

  if (!racers.length) {
    throw new Error('No racers found in umarble_racers');
  }

  if (!raceDoc) {
    throw new Error('No race found in umarble_races');
  }

  const simOptions = {
    stages: raceDoc.stages || 500,
    trackLength: raceDoc.trackLength || 1000,
    obstacles: raceDoc.obstacles || [],
    ticksPerStage: raceDoc.ticksPerStage || 10,
    weather: raceDoc.weather || undefined,
    random: options.random
  };

  const result = runRaceSimulation(racers, simOptions);
  return {
    ...result,
    racers,
    weather: simOptions.weather
  };
}

module.exports = { runMarbleRace };
