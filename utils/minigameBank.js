const { connectToMongo } = require('./mongodbUtil');

function weightedPick(items) {
    const total = items.reduce((s, it) => s + (typeof it.weight === 'number' ? it.weight : 1), 0);
    let r = Math.random() * total;
    for (const it of items) {
        r -= (typeof it.weight === 'number' ? it.weight : 1);
        if (r <= 0) return it;
    }
    return items[items.length - 1];
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
