const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Flexible plot renderer. Parameters:
// - result: { positionsHistory, final, ... }
// - options: { width, height, outFile, weather, tickSeconds, colorMap, writeToDisk (bool), returnBuffer (bool) }
// If options.returnBuffer is true, returns a Buffer. Otherwise if outFile provided or writeToDisk=true,
// writes to disk at outFile and returns the outFile path. If neither specified, returns Buffer.
async function renderRacePlot(result, options = {}) {
  const width = options.width || 1200;
  const height = options.height || 600;
  const outFile = options.outFile || null;
  const weather = (typeof options.weather !== 'undefined') ? options.weather : (result && result.weather) || 'sunny';
  const tickSeconds = options.tickSeconds || 0.12;
  const writeToDisk = (typeof options.writeToDisk === 'boolean') ? options.writeToDisk : !!outFile;
  const returnBuffer = !!options.returnBuffer;

  function ticksToTime(ticks) {
    if (!isFinite(ticks)) return 'DNF';
    const s = ticks * tickSeconds;
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    const ms = Math.round((s - Math.floor(s)) * 1000).toString().padStart(3, '0');
    return `${mm}:${ss}.${ms}`;
  }

  const positionsHistory = result.positionsHistory || {};
  const racerNames = Object.keys(positionsHistory);
  if (!racerNames.length) throw new Error('No positions recorded');

  const ticks = positionsHistory[racerNames[0]].length;
  const labels = Array.from({ length: ticks }, (_, i) => i + 1);

  // support optional colorMap; fallback to trying to require sample racers for colors
  let sampleRacers = [];
  try { sampleRacers = require('../umarble/racers').sampleRacers || []; } catch (e) { /* ignore */ }
  const colorMap = options.colorMap || (sampleRacers.length ? Object.fromEntries(sampleRacers.map(r => [r.name, r.color])) : {});

  const datasets = racerNames.map(name => {
    const color = colorMap[name] || '#000000';
    return {
      label: name,
      data: positionsHistory[name],
      borderColor: color,
      backgroundColor: color,
      fill: false,
      tension: 0.15,
      pointRadius: 0
    };
  });

  const winners = (result.final || []).filter(f => isFinite(f.finishedAt)).slice(0, 5);
  const runAt = new Date().toLocaleString();
  const avgDistance = (result.final && result.final.reduce ? (result.final.reduce((s, r) => s + (r.total || 0), 0) / result.final.length) : 0) || 0;

  const captionPlugin = {
    id: 'captionPlugin',
    beforeDraw: (chart) => {
      const ctx = chart.ctx;
      ctx.save();
      const pad = 14;
      const boxW = 220;
      const lineH = 18;
      const boxH = Math.max(80, (1 + winners.length) * lineH + 16);
      const boxX = chart.width - pad - boxW;
      const boxY = Math.floor(chart.height / 2 - boxH / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const r = 8;
      ctx.beginPath();
      ctx.moveTo(boxX + r, boxY);
      ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + r, r);
      ctx.arcTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH, r);
      ctx.arcTo(boxX, boxY + boxH, boxX, boxY + boxH - r, r);
      ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      let tx = boxX + 12;
      let ty = boxY + 20;
      if (winners.length) {
        ctx.fillText('Winners:', tx, ty);
        ty += lineH;
        winners.forEach((w, i) => {
          const line = `${i + 1}. ${w.name} — ${ticksToTime(w.finishedAt)}`;
          ctx.fillText(line, tx, ty);
          ty += lineH;
        });
      }

      const headerX = 80;
      const headerY = 10;
      ctx.save();
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'left';
      let emoji = '☀️';
      if (weather === 'rainy') emoji = '🌧️';
      else if (weather === 'snowy') emoji = '❄️';
      function capitalize(s){ if(!s) return ''; return s.charAt(0).toUpperCase()+s.slice(1); }
      ctx.fillStyle = '#222222'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${emoji} ${capitalize(weather)} — ${runAt}`, headerX + 40, headerY + 6);
      ctx.restore();
      ctx.restore();
    }
  };

  const configuration = {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: 'Umarble Race: Distance vs Time' },
        legend: { position: 'bottom' }
      },
      scales: {
        x: { title: { display: true, text: 'Ticks (≈seconds)' } },
        y: { title: { display: true, text: 'Distance (m)' }, beginAtZero: true, suggestedMax: 1000 }
      }
    },
    plugins: [captionPlugin]
  };

  let buffer;
  try {
    // Lazy-load so module-level require failures do not crash bot startup.
    const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });
    buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  } catch (nativeErr) {
    // Fallback: remote chart rendering via QuickChart (no native deps required).
    // Downsample position history to at most MAX_POINTS per racer to stay well within
    // QuickChart's request-size limits (large datasets cause 400 responses).
    const MAX_POINTS = 120;
    const step = ticks > MAX_POINTS ? Math.ceil(ticks / MAX_POINTS) : 1;
    const sampledLabels = labels.filter((_, i) => i % step === 0 || i === ticks - 1);

    // Derive y-axis max from final positions so the chart scales correctly.
    const maxPos = (result.final || []).reduce((m, r) => Math.max(m, r.total || 0), 0);
    const yMax = Math.max(maxPos * 1.05, 500);

    const sampledDatasets = racerNames.map(name => {
      const raw = positionsHistory[name];
      const color = colorMap[name] || '#888888';
      // Replace null (post-finish) with the last real value so lines don't drop off.
      let lastVal = 0;
      const filled = raw.map(v => { if (v !== null && v !== undefined) { lastVal = v; return v; } return lastVal; });
      const sampled = filled.filter((_, i) => i % step === 0 || i === filled.length - 1);
      return {
        label: name,
        data: sampled,
        borderColor: color,
        backgroundColor: color,
        fill: false,
        tension: 0.15,
        pointRadius: 0,
        borderWidth: 2
      };
    });

    const quickChartConfig = {
      type: 'line',
      data: { labels: sampledLabels, datasets: sampledDatasets },
      options: {
        responsive: false,
        spanGaps: true,
        plugins: {
          title: { display: true, text: `Umarble Race — ${weather.charAt(0).toUpperCase() + weather.slice(1)} | ${(result.final || []).map((r, i) => `${i + 1}. ${r.name}`).slice(0, 3).join(', ')}` },
          legend: { position: 'bottom' }
        },
        scales: {
          x: { title: { display: true, text: 'Ticks' } },
          y: { title: { display: true, text: 'Distance (m)' }, beginAtZero: true, suggestedMax: yMax }
        }
      }
    };

    try {
      const response = await axios.post('https://quickchart.io/chart', {
        width,
        height,
        backgroundColor: 'white',
        format: 'png',
        version: '3',
        chart: JSON.stringify(quickChartConfig)
      }, {
        responseType: 'arraybuffer',
        timeout: 20000
      });
      buffer = Buffer.from(response.data);
    } catch (fallbackErr) {
      const nativeMsg = nativeErr && nativeErr.message ? nativeErr.message : String(nativeErr);
      const fallbackMsg = fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr);
      throw new Error(`Native chart renderer unavailable (${nativeMsg}); fallback renderer failed (${fallbackMsg})`);
    }
  }

  if (writeToDisk && outFile) {
    fs.writeFileSync(outFile, buffer);
    try {
      fs.writeFileSync(path.join(path.dirname(outFile), 'last_race_positions.json'), JSON.stringify({ result, weather, avgDistance, generatedAt: new Date().toISOString() }, null, 2));
    } catch (e) { /* ignore write errors for positions */ }
    if (returnBuffer) return buffer;
    return outFile;
  }

  return buffer;
}

module.exports = { renderRacePlot };
