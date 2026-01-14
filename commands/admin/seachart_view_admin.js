const { SlashCommandBuilder } = require('discord.js');
const Jimp = require('jimp');
const path = require('path');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { getBoard } = require('../../utility/seachart');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seachart_view_admin')
    .setDescription('Render the Sea Chart with all seeded items (admin view)')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const db = await connectToMongo();
      const itemsCol = db.collection('seachart_items');
      const board = await getBoard();

      const cols = board.width;
      const rows = board.height;
      const cellSize = 48;
      const leftMargin = 60;
      const topMargin = 60;
      const width = leftMargin + cols * cellSize + 40;
      const height = topMargin + rows * cellSize + 100;

      const image = new Jimp(width, height, 0x1e487aff);
      const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_8_WHITE);
      const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
      const headerFont = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);

      // Draw column headers
      for (let c = 0; c < cols; c++) {
        const x = leftMargin + c * cellSize;
        const letter = String.fromCharCode(65 + c);
        image.print(font, x + Math.floor(cellSize / 3), topMargin - 30, letter);
      }

      // Draw grid and row headers
      const blockedSet = new Set((board.blocked || []).map(s => s.toUpperCase()));
      for (let r = 0; r < rows; r++) {
        const rowNum = String(r);
        const y = topMargin + r * cellSize;
        image.print(font, leftMargin - 40, y + Math.floor(cellSize / 2) - 8, rowNum);
        for (let c = 0; c < cols; c++) {
          const x = leftMargin + c * cellSize;
          const colLetter = String.fromCharCode(65 + c);
          const pos = `${colLetter}${r}`;
          const blocked = blockedSet.has(pos);
          const bgColor = blocked ? 0x444444FF : 0x2673D7FF;
          const cell = new Jimp(cellSize - 4, cellSize - 4, bgColor);
          image.composite(cell, x + 2, y + 2);
        }
      }

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

      // mapping of item types/imageKeys to small symbols
      const symbolMap = {
        star: '*',
        immunity: 'I',
        egg: 'E',
        nothing: '.',
        time: 'T',
        seance: 'S',
        curse: 'C',
        haunt: 'H',
        silent: 'L',
        confused: '?',
        old_key: 'K',
        old_box: 'B',
        broken_translator: 'X',
        message_bottle_1: '1',
        message_bottle_2: '2',
        message_bottle_3: '3',
        moth_fossil: 'M',
        iguana_fossil: 'G',
        marking_stone: 'O',
        filler: 'f'
      };

      // build combined list: board stars plus items collection
      const items = await itemsCol.find({}).toArray();
      const combined = [];
      // board stars
      for (const s of (board.stars || [])) combined.push({ position: s.toUpperCase(), kind: 'star' });
      // items from DB
      for (const it of items) combined.push({ position: (it.position || '').toUpperCase(), kind: it.type || 'filler', imageKey: it.imageKey || null, curseName: it.curseName || null });

      // overlay symbols; if multiple items on same cell, join them (up to 2 chars)
      const buckets = {};
      for (const it of combined) {
        if (!it.position) continue;
        if (!buckets[it.position]) buckets[it.position] = [];
        let sym = symbolMap[it.kind] || (it.imageKey && symbolMap[it.imageKey]) || '•';
        if (it.kind === 'curse' && it.curseName) {
          sym = symbolMap[it.curseName] || 'C';
        }
        buckets[it.position].push(sym);
      }

      for (const [pos, syms] of Object.entries(buckets)) {
        const xy = posToXY(pos);
        if (!xy) continue;
        const text = (syms.slice(0,2).join(''));
        image.print(fontSmall, xy.x + Math.floor(cellSize / 2) - 6, xy.y + Math.floor(cellSize / 2) - 6, text);
      }

      // title
      const title = 'Sea Chart — Items (admin)';
      const textWidth = Jimp.measureText(headerFont, title);
      image.print(headerFont, Math.floor((width - textWidth) / 2), height - 75, title);

      const buf = await image.getBufferAsync(Jimp.MIME_PNG);
      await interaction.editReply({ files: [{ attachment: buf, name: 'seachart_items.png' }], ephemeral: true });
    } catch (err) {
      console.error('seachart_view_admin error', err);
      try { await interaction.editReply({ content: 'Error rendering seachart admin view.', ephemeral: true }); } catch (e) {}
    }
  }
};
