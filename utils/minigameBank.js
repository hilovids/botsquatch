const { connectToMongo } = require('./mongodbUtil');

function weightedPick(items) {
    if (!items || items.length === 0) return null;
    const idx = Math.floor(Math.random() * items.length);
    return items[idx];
}

async function pickRandomChallenge() {
    const db = await connectToMongo();
    const col = db.collection('minigame_challenges');
    const docs = await col.find({}).toArray();
    if (!docs || docs.length === 0) return null;
    return weightedPick(docs);
}

async function getChallengeById(id) {
    if (!id) return null;
    const db = await connectToMongo();
    const col = db.collection('minigame_challenges');
    return col.findOne({ id: id });
}

module.exports = { pickRandomChallenge, getChallengeById };
