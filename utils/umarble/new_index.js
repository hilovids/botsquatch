// Demo runner: fetch racers + race from MongoDB, run simulation, log JSON, write plot
const path = require('path');
const { ObjectId } = require('mongodb');
const { connectToMongo, getDb } = require('../mongodbUtil');
const { runRaceSimulation } = require('./raceSimulator');
const { renderRacePlot } = require('./plotRace');

async function fetchRacers(db) {
  const coll = db.collection('umarble_racers');
  try {
    const docs = await coll.find({}).toArray();
    return docs.map(d => ({ name: d.name, stats: d.stats || {}, skills: d.skills || {}, skillTiming: d.skillTiming }));
  } catch (e) {
    console.error('Error fetching racers:', e);
    return [];
  }
}

async function fetchRaceById(db, id) {
  const coll = db.collection('umarble_races');
  try {
    const q = { _id: ObjectId.isValid(id) ? new ObjectId(id) : id };
    return await coll.findOne(q);
  } catch (e) {
    console.error('Error fetching race by id:', e);
    return null;
  }
}

async function main() {
  // CLI: node new_index.js [raceId] [outFile]
  const raceId = process.argv[2] || null;
  const outFileArg = process.argv[3] || null;

  // connect to marbleRacing DB
  const db = await connectToMongo('hilovidsSiteData');

  // fetch racers
  const racers = await fetchRacers(db);
  if (!racers.length) console.warn('No racers found in DB; simulation may use empty list');

  // fetch race: by id or latest
  let raceDoc = null;
  if (raceId) {
    raceDoc = await fetchRaceById(db, raceId);
  } else {
    try {
      const dbForQuery = getDb();
      const collection = dbForQuery.collection('umarble_races');
      raceDoc = await collection.findOne({}, { sort: { createdAt: -1 } });
    } catch (err) {
      console.error('Error fetching latest race:', err);
      raceDoc = null;
    }
  }
  if (!raceDoc) {
    console.error('No race found; aborting');
    process.exitCode = 2;
    return;
  }

  // build options for simulator
  const simOptions = {
    stages: raceDoc.stages || 500,
    trackLength: raceDoc.trackLength || 1000,
    obstacles: raceDoc.obstacles || [],
    ticksPerStage: raceDoc.ticksPerStage || 10,
    weather: raceDoc.weather || undefined
  };

  const result = runRaceSimulation(racers, simOptions);

  // print JSON to log
  console.log(JSON.stringify({ raceId: raceDoc._id, simOptions, resultSummary: { stages: result.stages.length, final: result.final } }, null, 2));

  // write plot to umarble folder (or outFileArg if provided)
  const outFile = outFileArg || path.join(__dirname, 'race_plot.png');
  try {
    await renderRacePlot(result, { outFile, weather: simOptions.weather, returnBuffer: false });
    console.log('Wrote plot to', outFile);
  } catch (err) {
    console.error('Error rendering plot:', err);
  }
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal error:', err); process.exitCode = 1; });
}

module.exports = { main };
