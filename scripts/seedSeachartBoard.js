const { connectToMongo } = require('../utils/mongodbUtil');
const board = require('../data/seachart_board.json');

(async function main(){
  try{
    const db = await connectToMongo();
    const col = db.collection('seachart_board');
    const existing = await col.findOne({ name: 'default' });
    if (existing){
      await col.updateOne({ name: 'default' }, { $set: { board: board, updatedAt: new Date() } });
      console.log('Updated existing board in MongoDB.');
    } else {
      await col.insertOne({ name: 'default', board: board, createdAt: new Date() });
      console.log('Inserted board into MongoDB.');
    }
    process.exit(0);
  }catch(err){
    console.error('Failed to seed board:', err);
    process.exit(1);
  }
})();
