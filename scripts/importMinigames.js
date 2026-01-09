const path = require('path');
const fs = require('fs');
const { connectToMongo } = require('../utils/mongodbUtil');

async function main() {
  try {
    const filePath = path.join(__dirname, '..', 'data', 'minigame_challenges.json');
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const docs = JSON.parse(raw);
    if (!Array.isArray(docs)) {
      console.error('Expected an array of challenge documents in', filePath);
      process.exit(1);
    }

    const db = await connectToMongo();
    const col = db.collection('minigame_challenges');

    const ops = docs.map(doc => ({
      updateOne: {
        filter: { id: doc.id },
        update: { $set: doc },
        upsert: true
      }
    }));

    if (ops.length === 0) {
      console.log('No documents to import.');
      process.exit(0);
    }

    const result = await col.bulkWrite(ops, { ordered: false });

    console.log('Import complete.');
    console.log('Matched:', result.matchedCount || 0);
    console.log('Modified:', result.modifiedCount || 0);
    console.log('Upserted:', (result.upsertedCount || 0));
    process.exit(0);
  } catch (err) {
    console.error('Import failed:', err);
    process.exit(2);
  }
}

main();
