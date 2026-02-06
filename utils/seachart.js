const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { connectToMongo } = require('./mongodbUtil');

const BOARD_PATH = path.join(__dirname, '..', 'data', 'seachart_board.json');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function loadBoardFromFile() {
    const raw = fs.readFileSync(BOARD_PATH, 'utf8');
    const board = JSON.parse(raw);
    return board;
}

async function getBoard() {
    // try to load board from MongoDB; fallback to file
    try {
        const db = await connectToMongo();
        const col = db.collection('seachart_board');
        const doc = await col.findOne({ _id: 'global' });
        if (doc && doc.board) return doc.board;
        if (doc) return doc; // older format
    } catch (e) {
        // ignore and fallback to file
    }
    return loadBoardFromFile();
}

function randInt(max) { return Math.floor(Math.random() * max); }

async function ensurePlaced(campersColl, camper) {
    if (camper && camper.seachart_loc) return camper.seachart_loc;
    const board = await getBoard();

    // build columns A.. based on board width
    const cols = [];
    for (let i = 0; i < board.width; i++) cols.push(String.fromCharCode(65 + i));
    const rows = Array.from({ length: board.height }, (_, i) => i);

    // Build blocked set
    const blocked = new Set((board.blocked || []).map(s => s.toUpperCase()));

    // Build occupied set from existing campers (avoid putting two campers on same cell)
    const occupiedDocs = await campersColl.find({ seachart_loc: { $exists: true, $ne: null } }).project({ seachart_loc: 1 }).toArray();
    const occupied = new Set((occupiedDocs || []).map(d => (d.seachart_loc || '').toUpperCase()));

    // choose a random interactable and unoccupied cell
    let chosen = null;
    for (let attempts = 0; attempts < 5000; attempts++) {
        const c = cols[randInt(cols.length)];
        const r = rows[randInt(rows.length)];
        const pos = `${c}${r}`;
        if (!blocked.has(pos) && !occupied.has(pos)) { chosen = pos; break; }
    }
    // fallback: find first non-blocked cell
    if (!chosen) {
        outer: for (const c of cols) {
            for (const r of rows) {
                const pos = `${c}${r}`;
                if (!blocked.has(pos) && !occupied.has(pos)) { chosen = pos; break outer; }
            }
        }
    }

    if (!chosen) chosen = `A0`;

    await campersColl.updateOne({ discordId: camper.discordId }, { $set: { seachart_loc: chosen } });
    return chosen;
}

// Returns true only if at least 3 full days (72 hours) have passed since lastDate
function isNewLocalDay(lastDate, timezone) {
    if (!lastDate) return true;
    try {
        const last = new Date(lastDate);
        const now = new Date();
        const diff = now.getTime() - last.getTime();
        return diff >= 3 * 24 * 60 * 60 * 1000;
    } catch (e) {
        // on error, be conservative and say it's not a new day
        return false;
    }
}

// Returns a unix timestamp (seconds) when the user will next be allowed to use the daily seachart action
function nextSeachartAvailable(lastDate) {
    if (!lastDate) return 0;
    try {
        const last = new Date(lastDate);
        const next = new Date(last.getTime() + 3 * 24 * 60 * 60 * 1000);
        return Math.floor(next.getTime() / 1000);
    } catch (e) {
        return 0;
    }
}

async function renderBoardImage(viewer) {
    const board = await getBoard();
    const cols = board.width;
    const rows = board.height;
    const cellSize = 48;
    const leftMargin = 60;
    const topMargin = 60;
    const width = leftMargin + cols * cellSize + 40;
    const height = topMargin + rows * cellSize + 100;

    const image = new Jimp(width, height, 0x003280FF);
    const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
    const headerFont = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);

    // Draw column letter headers (letters across the top)
    for (let c = 0; c < cols; c++) {
        const x = leftMargin + c * cellSize;
        const letter = String.fromCharCode(65 + c);
        image.print(font, x + Math.floor(cellSize / 3), topMargin - 30, letter);
    }

    // Draw grid and row number headers (numbers down the left)
    for (let r = 0; r < rows; r++) {
        const rowNum = String(r);
        const y = topMargin + r * cellSize;
        // left-side number
        image.print(font, leftMargin - 40, y + Math.floor(cellSize / 2) - 8, rowNum);
        for (let c = 0; c < cols; c++) {
            const x = leftMargin + c * cellSize;
            const colLetter = String.fromCharCode(65 + c);
            const pos = `${colLetter}${r}`;
            const blocked = (board.blocked || []).map(s => s.toUpperCase()).includes(pos);
            const bgColor = blocked ? 0x444444FF : 0x2673D7FF;
            const cell = new Jimp(cellSize - 4, cellSize - 4, bgColor);
            image.composite(cell, x + 2, y + 2);
        }
    }

    // helper to map board position to screen x,y (no flipping)
    function posToXY(pos) {
        const p = pos.toUpperCase();
        const col = p.charCodeAt(0) - 65;
        const row = parseInt(p.slice(1), 10);
        if (isNaN(col) || isNaN(row)) return null;
        if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
        const x = leftMargin + col * cellSize;
        const y = topMargin + row * cellSize;
        return { x, y };
    }

    // create a simple star icon
    async function createStarIcon(size) {
        const icon = new Jimp(size, size, 0x00000000);
        const center = size / 2;
        const radius = Math.floor(size / 2 - 1);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - center + 0.5;
                const dy = y - center + 0.5;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d <= radius) icon.setPixelColor(0xFFFF00FF, x, y);
            }
        }
        return icon;
    }

    const scanned = (viewer && viewer.seachart_scans) || {};
    const dredged = (viewer && viewer.seachart_dredged) || {};
    const boardStars = (board.stars || []).map(s => s.toUpperCase());
    const starIcon = await createStarIcon(Math.floor(cellSize * 0.6));

    // create dredge icons
    async function createDredgeIcon(size, hex) {
        const icon = new Jimp(size, size, 0x00000000);
        const center = size / 2;
        const radius = Math.floor(size / 2 - 2);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - center + 0.5;
                const dy = y - center + 0.5;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d <= radius) icon.setPixelColor(hex, x, y);
            }
        }
        return icon;
    }
    const dredgeFoundIcon = await createDredgeIcon(Math.floor(cellSize * 0.55), 0x00FF00FF); // green
    const dredgeNothingIcon = await createDredgeIcon(Math.floor(cellSize * 0.55), 0x808080FF); // gray

    // render scanned numbers (viewer-specific) with star priority
    for (const [posKey, val] of Object.entries(scanned)) {
        const pos = posKey.toUpperCase();
        const xy = posToXY(pos);
        if (!xy) continue;
        if (boardStars.includes(pos)) {
            image.composite(starIcon, xy.x + Math.floor((cellSize - starIcon.bitmap.width) / 2) + 2, xy.y + Math.floor((cellSize - starIcon.bitmap.height) / 2) + 2);
            continue;
        }
        image.print(font, xy.x + Math.floor(cellSize / 2) - 6, xy.y + Math.floor(cellSize / 2) - 10, String(val));
    }

    // render dredged icons so they stand out from numbers
    for (const [posKey, state] of Object.entries(dredged)) {
        const pos = posKey.toUpperCase();
        const xy = posToXY(pos);
        if (!xy) continue;
        const isNothing = String(state).toLowerCase() === 'nothing';
        const icon = isNothing ? dredgeNothingIcon : dredgeFoundIcon;
        image.composite(icon, xy.x + Math.floor((cellSize - icon.bitmap.width) / 2) + 2, xy.y + Math.floor((cellSize - icon.bitmap.height) / 2) + 2);
    }

    // render board stars (visible regardless)
    // for (const s of boardStars) {
    //     const xy = posToXY(s);
    //     if (!xy) continue;
    //     image.composite(starIcon, xy.x + Math.floor((cellSize - starIcon.bitmap.width) / 2) + 2, xy.y + Math.floor((cellSize - starIcon.bitmap.height) / 2) + 2);
    // }

    // render viewer marker (star icon) at viewer location
    if (viewer && viewer.seachart_loc) {
        const vpos = viewer.seachart_loc.toUpperCase();
        const vxy = posToXY(vpos);
        if (vxy) {
            image.composite(starIcon, vxy.x + Math.floor((cellSize - starIcon.bitmap.width) / 2) + 2, vxy.y + Math.floor((cellSize - starIcon.bitmap.height) / 2) + 2);
        }
    }

    // Legend removed from image — legend is provided in the embed instead.

    // centered title at bottom middle
    const title = 'Lake Yazzy';
    const textWidth = Jimp.measureText(headerFont, title);
    image.print(headerFont, Math.floor((width - textWidth) / 2), height - 75, title);

    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    return buffer;
}

function itemImagePathForType(type) {
    const map = {
        egg: 'egg_token.png',
        time: 'time_token.png',
        seance: 'seance_token.png',
        immunity: 'immunity_token.png',
        vote: 'vote_board.png',
        nothing: 'nothing_token.png',
        silent_curse: 'silent_curse.png',
        confusion_curse: 'confusion_curse.png',
        haunt_curse: 'haunt_curse.png',
        star: null
    };
    return map[type] ? path.join(ASSETS_DIR, map[type]) : null;
}

async function handleFindItem(db, camper, pos) {
    const itemsColl = db.collection('seachart_items');
    const campersColl = db.collection('campers');
    const position = pos.toUpperCase();
    const board = await getBoard();

    // Stars are persistent and can be on board
    if ((board.stars || []).map(s => s.toUpperCase()).includes(position)) {
        // award a star (allow repeated finds) — increment stars count for each dredge
        const inc = { 'inventory.stars': 1 };
        await campersColl.updateOne({ discordId: camper.discordId }, { $inc: inc });
        const imgPath = path.join(ASSETS_DIR, 'star.png');
        return { type: 'star', image: imgPath, filename: 'star.png', text: `You found a star at ${position}! (+1 star)` };
    }

    const item = await itemsColl.findOne({ position: position });
    if (!item) {
        // default nothing
        await campersColl.updateOne({ discordId: camper.discordId }, { $inc: { 'inventory.nothingTokens': 1 } });
        const imgPath = path.join(ASSETS_DIR, 'nothing.png');
        return { type: 'nothing', image: imgPath, filename: 'nothing.png', text: `Nothing found at ${position}.` };
    }

    const type = item.type || 'nothing';
    // filler items should always be findable and not be marked as found
    if (type === 'filler') {
        const imgName = (item.imageKey ? `${item.imageKey}.png` : 'found.png');
        const imgPath = itemImagePathForType(item.imageKey) || path.join(ASSETS_DIR, imgName) || path.join(ASSETS_DIR, 'found.png');
        return { type: 'filler', image: imgPath, filename: imgName, text: item.text || `You found something at ${position}.` };
    }
    // If curse type, set curse on camper but do not mark as found/removed
    if (type === 'curse') {
        const curseName = item.curseName || 'confused';
        // map 'haunt' curse to the noVote field in camper.curses
        const fieldName = (curseName === 'haunt' || curseName === 'haunt_curse') ? 'noVote' : curseName;
        const update = {};
        update[`curses.${fieldName}`] = true;
        await campersColl.updateOne({ discordId: camper.discordId }, { $set: update });
        return { type: 'curse', image: itemImagePathForType(item.imageKey || 'silent_curse'), text: `You found a curse (${fieldName}). You are now cursed.` };
    }

    // Stars handled earlier, other items: if already found, notify
    if (item.foundBy && item.foundBy !== null) {
        const imgPath = path.join(ASSETS_DIR, 'found.png');
        return { type: 'already', image: imgPath, filename: 'found.png', text: `Someone already found the item at ${position}.` };
    }

    // award item and mark found
    const incMap = {};
    switch (type) {
        case 'egg': incMap['inventory.eggToken'] = 1; break;
        case 'time': incMap['inventory.timeTokens'] = 1; break;
        case 'seance': incMap['inventory.seanceTokens'] = 1; break;
        case 'immunity': incMap['inventory.immunityTokens'] = 1; break;
        case 'vote': incMap['inventory.voteTokens'] = 1; break;
        case 'nothing': incMap['inventory.nothingTokens'] = 1; break;
        default: break;
    }
    if (Object.keys(incMap).length) await campersColl.updateOne({ discordId: camper.discordId }, { $inc: incMap });
    await itemsColl.updateOne({ _id: item._id }, { $set: { foundBy: camper.discordId, foundAt: new Date() } });

    return { type, image: itemImagePathForType(item.imageKey || type), text: `You found ${type} at ${position}!` };
}

module.exports = { getBoard, loadBoardFromFile, ensurePlaced, isNewLocalDay, nextSeachartAvailable, renderBoardImage, handleFindItem };
// pathfinding helper: canReach(startPos, targetPos, maxSteps)
async function canReach(startPos, targetPos, maxSteps) {
    const board = await getBoard();
    const cols = board.width;
    const rows = board.height;
    const blocked = new Set((board.blocked || []).map(s => s.toUpperCase()));

    function parsePos(p){
        if(!p) return null;
        const P = p.toUpperCase();
        const col = P.charCodeAt(0) - 65;
        const row = parseInt(P.slice(1),10);
        if (isNaN(col) || isNaN(row)) return null;
        return {col,row};
    }
    function posFor(c,r){ return `${String.fromCharCode(65 + c)}${r}`.toUpperCase(); }

    const s = parsePos(startPos);
    const t = parsePos(targetPos);
    if(!s || !t) return { ok: false, reason: 'invalid' };
    // quick bounds and blocked checks
    if (s.col < 0 || s.col >= cols || s.row < 0 || s.row >= rows) return { ok:false, reason:'start_out' };
    if (t.col < 0 || t.col >= cols || t.row < 0 || t.row >= rows) return { ok:false, reason:'target_out' };
    if (blocked.has(posFor(t.col,t.row))) return { ok:false, reason:'target_blocked' };

    const startKey = `${s.col},${s.row}`;
    const targetKey = `${t.col},${t.row}`;

    const visited = new Set();
    const q = [{col: s.col, row: s.row, steps: 0}];
    visited.add(startKey);
    let sawCornerBlock = false;

    while(q.length){
        const cur = q.shift();
        if (cur.col === t.col && cur.row === t.row) return { ok:true };
        if (cur.steps >= maxSteps) continue;
        for (let dx = -1; dx <= 1; dx++){
            for (let dy = -1; dy <= 1; dy++){
                if (dx === 0 && dy === 0) continue;
                const nx = cur.col + dx;
                const ny = cur.row + dy;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                const npos = posFor(nx, ny);
                if (blocked.has(npos)) continue;
                // diagonal movement corner-cut check: require at least one orthogonal open
                if (dx !== 0 && dy !== 0) {
                    const o1 = posFor(cur.col + dx, cur.row);
                    const o2 = posFor(cur.col, cur.row + dy);
                    if (blocked.has(o1) && blocked.has(o2)) { sawCornerBlock = true; continue; }
                }
                const key = `${nx},${ny}`;
                if (visited.has(key)) continue;
                visited.add(key);
                q.push({col: nx, row: ny, steps: cur.steps + 1});
            }
        }
    }
    return { ok: false, reason: sawCornerBlock ? 'corner_block' : 'no_path' };
}

module.exports.canReach = canReach;
