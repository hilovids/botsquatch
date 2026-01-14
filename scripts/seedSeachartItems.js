const { connectToMongo } = require('../utils/mongodbUtil');

(async function main(){
  try{
    const db = await connectToMongo();
    const items = db.collection('seachart_items');

    // We'll build a statistical seed of items and write them to the items collection.
    // Clear existing items for a fresh seed (be aware: this will remove found state)
    await items.deleteMany({});

    const board = require('../data/seachart_board.json');
    // build list of all non-blocked positions
    const cols = [];
    for (let i = 0; i < board.width; i++) cols.push(String.fromCharCode(65 + i));
    const rows = Array.from({ length: board.height }, (_, i) => i);

    const blocked = new Set((board.blocked || []).map(s => s.toUpperCase()));

    const allPositions = [];
    for (const c of cols){
      for (const r of rows){
        const pos = `${c}${r}`;
        if (!blocked.has(pos)) allPositions.push(pos);
      }
    }

    function shuffle(array){
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
    }

    // utility to pick N positions from available with an optional minManhattan spacing
    function manhattan(a,b){
      const ca = a.charCodeAt(0) - 65; const ra = parseInt(a.slice(1),10);
      const cb = b.charCodeAt(0) - 65; const rb = parseInt(b.slice(1),10);
      return Math.abs(ca - cb) + Math.abs(ra - rb);
    }

    function pickFarPositions(available, count, minDist){
      if (count <= 0) return [];
      const pool = available.slice();
      shuffle(pool);
      const chosen = [];
      let attempts = 0;
      while (pool.length && chosen.length < count && attempts < 50000){
        attempts++;
        const cand = pool.shift();
        let ok = true;
        for (const ch of chosen) if (manhattan(ch, cand) < minDist) { ok = false; break; }
        if (ok) chosen.push(cand);
      }
      return chosen;
    }

    // compute counts
    const totalOpen = allPositions.length;
    const starsCount = Math.round(totalOpen * 0.20);
    const nothingCount = 5 + Math.floor(Math.random() * 6); // 5-10
    const timeCount = 3;
    const seanceCount = 5;
    const immunityCount = 2;
    const eggCount = 1;
    const cursesTotal = Math.round(totalOpen * 0.10);

    // start with a shuffled available array for assignment
    shuffle(allPositions);
    const available = allPositions.slice();

    const seedItems = [];

    // place marking stones explicitly
    const forced = [ 'G5', 'N9' ];
    for (const pos of forced){
      if (!blocked.has(pos)) seedItems.push({ position: pos, type: 'filler', imageKey: 'marking_stone', foundBy: null, createdAt: new Date() });
      // remove from available
      const idx = available.findIndex(p => p === pos);
      if (idx >= 0) available.splice(idx,1);
    }

    // place stars into board.stars and update board object
    shuffle(available);
    const stars = available.slice(0, starsCount);
    // reserve stars from available
    for (const s of stars){ const i = available.indexOf(s); if (i>=0) available.splice(i,1); }

    // place immunity and egg tokens spaced far apart (require minDist)
    const specialPositions = pickFarPositions(available, immunityCount + eggCount, Math.max(6, Math.floor(Math.min(board.width, board.height) / 3)));
    for (let i=0;i<specialPositions.length;i++){
      const pos = specialPositions[i];
      if (i < immunityCount) seedItems.push({ position: pos, type: 'immunity', imageKey: 'immunity', foundBy: null, createdAt: new Date() });
      else seedItems.push({ position: pos, type: 'egg', imageKey: 'egg', foundBy: null, createdAt: new Date() });
      const idx = available.indexOf(pos); if (idx>=0) available.splice(idx,1);
    }

    // nothing tokens
    shuffle(available);
    const nothingPositions = available.slice(0, nothingCount);
    for (const pos of nothingPositions){ seedItems.push({ position: pos, type: 'nothing', imageKey: 'nothing', foundBy: null, createdAt: new Date() }); }
    for (const p of nothingPositions){ const i = available.indexOf(p); if (i>=0) available.splice(i,1); }

    // time tokens
    shuffle(available);
    const timePositions = available.slice(0, timeCount);
    for (const pos of timePositions){ seedItems.push({ position: pos, type: 'time', imageKey: 'time', foundBy: null, createdAt: new Date() }); }
    for (const p of timePositions){ const i = available.indexOf(p); if (i>=0) available.splice(i,1); }

    // seance tokens
    shuffle(available);
    const seancePositions = available.slice(0, seanceCount);
    for (const pos of seancePositions){ seedItems.push({ position: pos, type: 'seance', imageKey: 'seance', foundBy: null, createdAt: new Date() }); }
    for (const p of seancePositions){ const i = available.indexOf(p); if (i>=0) available.splice(i,1); }

    // curses: split roughly equally into three curse types (haunt -> noVote, silent, confused)
    shuffle(available);
    const cursePositions = available.slice(0, cursesTotal);
    const perCurse = Math.floor(cursePositions.length / 3);
    const remainder = cursePositions.length - perCurse * 3;
    let curseIdx = 0;
    function pushCurse(pos, curseName){ seedItems.push({ position: pos, type: 'curse', imageKey: `${curseName}_curse`, curseName, foundBy: null, createdAt: new Date() }); }
    for (let i=0;i<perCurse;i++){ pushCurse(cursePositions[curseIdx++], 'haunt'); }
    for (let i=0;i<perCurse;i++){ pushCurse(cursePositions[curseIdx++], 'silent'); }
    for (let i=0;i<perCurse;i++){ pushCurse(cursePositions[curseIdx++], 'confused'); }
    // distribute remainder
    const extras = ['haunt','silent','confused'];
    for (let r=0;r<remainder && curseIdx < cursePositions.length; r++){ pushCurse(cursePositions[curseIdx++], extras[r % extras.length]); }
    for (const p of cursePositions){ const i = available.indexOf(p); if (i>=0) available.splice(i,1); }

    // filler items (do not update player inventory)
    const fillerNames = [
      { key: 'old_key', type: 'filler' },
      { key: 'old_box', type: 'filler' },
      { key: 'broken_translator', type: 'filler' },
      { key: 'message_bottle_1', type: 'filler' },
      { key: 'message_bottle_2', type: 'filler' },
      { key: 'message_bottle_3', type: 'filler' },
      { key: 'moth_fossil', type: 'filler' },
      { key: 'iguana_fossil', type: 'filler' }
    ];
    shuffle(available);
    for (const meta of fillerNames){
      if (available.length === 0) break;
      const pos = available.shift();
      seedItems.push({ position: pos, type: meta.type, imageKey: meta.key, foundBy: null, createdAt: new Date() });
    }

    // finally, write stars into board.stars (and attempt to upsert into seachart_board collection)
    board.stars = (board.stars || []).concat(stars.map(s => s.toUpperCase()));
    try{
      const dbCol = db.collection('seachart_board');
      await dbCol.updateOne({ _id: 'global' }, { $set: { board } }, { upsert: true });
      console.log('Updated seachart_board collection with stars.');
    }catch(e){ console.log('Could not update seachart_board collection, continuing.'); }

    // insert seed items into items collection
    if (seedItems.length) {
      await items.insertMany(seedItems);
      console.log(`Inserted ${seedItems.length} seed items.`);
    }

    // Now assign random valid positions to campers missing seachart_loc
    // Reuse the previously loaded board, cols, rows, blocked, and allPositions variables

    // Make a fresh copy of allPositions for assignment
    const allPositionsForCampers = allPositions.slice();

    shuffle(allPositionsForCampers);

    const campers = db.collection('campers');
    const existingOccupied = await campers.find({ seachart_loc: { $exists: true, $ne: null } }).project({ seachart_loc: 1 }).toArray();
    const occupiedSet = new Set((existingOccupied||[]).map(d => (d.seachart_loc||'').toUpperCase()));

    // filter available positions to those not occupied
    const availableForCampers = allPositionsForCampers.filter(p => !occupiedSet.has(p));

    if (availableForCampers.length === 0) {
      console.log('No available positions to assign to campers.');
      process.exit(0);
    }

    // Rewrite player locations: assign every camper a new position from available list
    shuffle(availableForCampers);
    const cursor = campers.find({}).sort({ _id: 1 });
    let idx = 0;
    while (await cursor.hasNext()){
      const doc = await cursor.next();
      if (idx >= availableForCampers.length) {
        console.log('Not enough available positions for all campers. Stopping assignments.');
        break;
      }
      const pos = availableForCampers[idx++];
      await campers.updateOne({ _id: doc._id }, { $set: { seachart_loc: pos } });
      console.log(`Assigned ${doc.displayName || doc.preferred_name || doc.username || doc.discordId} -> ${pos}`);
    }

    console.log('Seeding complete.');
    process.exit(0);
  }catch(err){
    console.error('Seeding failed:', err);
    process.exit(1);
  }
})();
