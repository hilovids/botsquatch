const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

// Usage: node scripts/paintToBoard.js <image.png> [--apply]
// Expects a 15x21 image where each pixel maps to a board cell.
// Color rules (defaults):
//  - blocked: dark pixels (brightness < 64)
//  - star: yellow-ish pixels (r>200 && g>160 && b<140)
// The script prints JSON for `blocked` and `stars`. With `--apply` it
// writes a new file `data/seachart_board.fromimage.json` containing the
// original board shape with updated `blocked` and `stars` arrays.

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/paintToBoard.js <image.png> [--apply]');
    process.exit(1);
  }
  const imgPath = args[0];
  const apply = args.includes('--apply');

  const img = await Jimp.read(imgPath);
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  if (width !== 15 || height !== 21) {
    console.error(`Expected 15x21 image but got ${width}x${height}`);
    process.exit(2);
  }

  const blocked = [];
  const stars = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x);
      const pos = String.fromCharCode(65 + x) + String(y);
      const color = img.getPixelColor(x, y);
      const { r, g, b, a } = Jimp.intToRGBA(color);
      const brightness = (r + g + b) / 3;

      // blocked if very dark or fully opaque black
      if (brightness < 64) {
        blocked.push(pos);
        continue;
      }

      // star if yellow-ish (tunable)
      if (r > 200 && g > 160 && b < 140) {
        stars.push(pos);
        continue;
      }

      // otherwise leave as water
    }
  }

  const out = { blocked: blocked.sort(), stars: stars.sort() };
  console.log('Blocked:', JSON.stringify(out.blocked, null, 2));
  console.log('Stars :', JSON.stringify(out.stars, null, 2));

  if (apply) {
    const boardPath = path.join(__dirname, '..', 'data', 'seachart_board.json');
    let board = {};
    try { board = JSON.parse(fs.readFileSync(boardPath, 'utf8')); } catch (e) { board = { width: 15, height: 21 }; }
    board.blocked = out.blocked;
    board.stars = out.stars;
    const outPath = path.join(__dirname, '..', 'data', 'seachart_board.fromimage.json');
    fs.writeFileSync(outPath, JSON.stringify(board, null, 2), 'utf8');
    console.log('Wrote', outPath);
  }
}

main().catch(err => { console.error(err); process.exit(99); });
