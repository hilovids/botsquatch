// Player command: /umarble_race
// Once per week, starts a horse race with a 5-minute betting period in a new thread.
const path = require('path');
const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { runRaceSimulation } = require('../../utils/umarble/raceSimulator');
const { renderRacePlot } = require('../../utils/umarble/plotRace');

const BETTING_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
const UMARBLE_EMBED_COLOR = '#14ae5c';
const UMARBLE_SILVER_COLOR = '#C0C0C0';
const UMARBLE_GOLD_COLOR = '#FFD700';
const UMARBLE_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'umarble_icon.png');
const UMARBLE_GIF_PATH = path.join(__dirname, '..', '..', 'assets', 'umarble_gif.gif');

const WEATHER_LABELS = { sunny: '☀️ Sunny', rainy: '🌧️ Rainy', snowy: '❄️ Snowy' };

const OBSTACLE_POOL = [
  { type: 'pit',    name: 'Mud Pit' },
  { type: 'pit',    name: 'Gravel Trap' },
  { type: 'pit',    name: 'Sand Trap' },
  { type: 'narrow', name: 'Narrow Bridge' },
  { type: 'narrow', name: 'Tight Alley' },
  { type: 'narrow', name: 'Rocky Pass' },
  { type: 'boost',  name: 'Speed Strip' },
  { type: 'boost',  name: 'Spring Pad' },
  { type: 'boost',  name: 'Rocket Rail' },
];

// Weather modifiers mirrored from raceSimulator for power estimation
const WEATHER_MODIFIERS = {
  sunny: { Agility: 1.15, Brawn: 0.95, Endurance: 0.95 },
  rainy: { Agility: 0.90, Brawn: 1.12, Endurance: 1.00 },
  snowy: { Agility: 0.85, Brawn: 1.00, Endurance: 1.15 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function iconFile() { return new AttachmentBuilder(UMARBLE_ICON_PATH, { name: 'umarble_icon.png' }); }
function gifFile()  { return new AttachmentBuilder(UMARBLE_GIF_PATH,  { name: 'umarble_gif.gif'  }); }

function applyStyle(embed, color = UMARBLE_EMBED_COLOR) {
  return embed.setColor(color).setThumbnail('attachment://umarble_icon.png');
}

// Estimate a horse's speed potential under given weather
function horsePower(stats, weather) {
  const wm = WEATHER_MODIFIERS[weather] || {};
  const a = (stats.Agility   || 0) * (wm.Agility   || 1);
  const b = (stats.Brawn     || 0) * (wm.Brawn     || 1);
  const e = (stats.Endurance || 0) * (wm.Endurance || 1);
  return 3 + a * 3 + b * 1.2 + e * 0.9
    + (stats.Luck    || 0) * 0.3
    + (stats.Mind    || 0) * 0.1
    + (stats.Resolve || 0) * 0.15;
}

// Returns decimal odds for each horse (index-aligned with horses array).
// Blends stat-based probability with historical win-rate (Laplace smoothed).
function computeOdds(horses, weather) {
  const powers = horses.map(h => horsePower(h.stats || {}, weather));
  const totalPow = powers.reduce((s, p) => s + p, 0) || 1;
  const statProbs = powers.map(p => p / totalPow);

  const winRates = horses.map(h => (((h.wins || 0) + 1) / ((h.wins || 0) + (h.losses || 0) + 2)));
  const totalWR = winRates.reduce((s, r) => s + r, 0) || 1;
  const wrProbs = winRates.map(r => r / totalWR);

  const blended = statProbs.map((p, i) => 0.65 * p + 0.35 * wrProbs[i]);
  const totalBl = blended.reduce((s, p) => s + p, 0) || 1;
  return blended.map(p => Math.max(1.05, 1 / (p / totalBl)));
}

// ─── Embed builders ───────────────────────────────────────────────────────────

function buildBettingEmbed(horses, odds, bettingClosesAt, weather, trackLength, obstacles) {
  const closeTs = `<t:${Math.floor(bettingClosesAt / 1000)}:R>`;
  const horseLines = horses.map((h, i) => {
    const w = h.wins || 0;
    const l = h.losses || 0;
    return `**${i + 1}. ${h.name}** (${w}W–${l}L) — Odds: \`${odds[i].toFixed(2)}x\``;
  });
  const obsLines = obstacles.length
    ? obstacles.map(o => `• ${o.name} @ ${o.pos}m`).join('\n')
    : 'None';

  return new EmbedBuilder()
    .setColor(UMARBLE_GOLD_COLOR)
    .setThumbnail('attachment://umarble_icon.png')
    .setTitle('🏁 Umarble Race — Place Your Bets!')
    .setDescription(`Betting closes ${closeTs}\n\nClick a horse's button to open a bet form!`)
    .addFields(
      { name: '🌤️ Weather',      value: WEATHER_LABELS[weather] || weather, inline: true },
      { name: '📏 Track Length', value: `${trackLength}m`,                  inline: true },
      { name: '⚠️ Obstacles',    value: obsLines,                           inline: false },
      { name: '🐴 Horses',       value: horseLines.join('\n'),              inline: false },
    )
    .setFooter({ text: 'One bet per player. Switching horses refunds your previous bet.' });
}

function buildHorseButtons(horses, raceId, disabled = false) {
  const rows = [];
  // Discord allows max 5 buttons per row; with 6 horses we need 2 rows (5 + 1).
  for (let i = 0; i < horses.length; i += 5) {
    const row = new ActionRowBuilder();
    for (let j = i; j < Math.min(i + 5, horses.length); j++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`umarble_bet:${raceId}:${j}`)
          .setLabel(horses[j].name.substring(0, 80))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildStageLeaderboardEmbed(stage) {
  const sorted = (stage.positions || []).slice().sort((a, b) => b.pos - a.pos);
  const top    = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();
  const fmt = (e, i, fromBot = false) =>
    `${fromBot ? `#${i + 1} from last` : `#${i + 1}`} • ${e.name} — ${e.pos.toFixed(1)}m`;
  return applyStyle(new EmbedBuilder()
    .setTitle(`Umarble Race — Stage ${stage.stage} Leaderboard`)
    .addFields(
      { name: 'Top 5',    value: top.length    ? top.map((e, i) => fmt(e, i)).join('\n')       : 'N/A', inline: true },
      { name: 'Bottom 5', value: bottom.length ? bottom.map((e, i) => fmt(e, i, true)).join('\n') : 'N/A', inline: true },
    ), UMARBLE_SILVER_COLOR);
}

function buildFinalResultsEmbed(final) {
  return applyStyle(new EmbedBuilder()
    .setTitle('🏆 Umarble Race — Final Results')
    .setDescription(
      final.map((r, i) =>
        `**${i + 1}. ${r.name}** — ${r.total.toFixed(1)}m` +
        (r.finishedAt !== Infinity ? ` (finished tick ${r.finishedAt})` : ' (DNF)'),
      ).join('\n'),
    ), UMARBLE_GOLD_COLOR);
}

function isFinishEvent(evt) {
  if (!evt) return false;
  if (evt.type === 'finish') return true;
  return typeof evt.msg === 'string' && / finished \(t=\d+\)/i.test(evt.msg);
}

function toRelativeTimestamp(msFromNow) {
  return `<t:${Math.floor((Date.now() + msFromNow) / 1000)}:R>`;
}

function stripCountdown(desc = '') {
  return typeof desc === 'string'
    ? desc.replace(/\n\nMore from the track\s*<t:\d+:R>\./i, '')
    : desc;
}

async function clearPriorTimerMessage(message) {
  if (!message || !Array.isArray(message.embeds) || !message.embeds.length) return;
  const src = message.embeds[0];
  const next = stripCountdown(src.description || '');
  if (next === src.description) return;
  const upd = new EmbedBuilder()
    .setTitle(src.title || null)
    .setDescription(next)
    .setColor(src.color || UMARBLE_EMBED_COLOR);
  if (Array.isArray(src.fields) && src.fields.length) upd.addFields(src.fields);
  if (src.footer?.text) upd.setFooter({ text: src.footer.text });
  await message.edit({ embeds: [upd] }).catch(() => {});
}

function pickChunkSize(remaining) {
  const max = Math.min(5, remaining);
  const min = Math.min(3, max);
  return randomInt(min, max);
}

function weightedDelayMs(chunkSize) {
  const base = randomInt(10000, 25000);
  return Math.max(10000, Math.min(25000, base + (chunkSize - 4) * 1500));
}

// ─── Race runner (posts updates directly to a thread channel) ─────────────────

async function runRaceInThread(thread, raceResult) {
  const { stages, final, weather, racers } = raceResult;

  // Opening animation
  try {
    await thread.send({
      embeds: [applyStyle(new EmbedBuilder()
        .setTitle('🏁 Umarble Race — The Gates Open!')
        .setDescription('And they\'re off!')
        .setImage('attachment://umarble_gif.gif'), UMARBLE_EMBED_COLOR)],
      files: [iconFile(), gifFile()],
    });
  } catch {
    await thread.send({
      embeds: [applyStyle(new EmbedBuilder()
        .setTitle('🏁 Umarble Race — The Gates Open!')
        .setDescription('And they\'re off!'))],
      files: [iconFile()],
    });
  }

  const stageList = Array.isArray(stages) ? stages : [];
  let lastTimedMsg = null;

  for (const stage of stageList) {
    await thread.send({
      embeds: [applyStyle(new EmbedBuilder()
        .setTitle(`Umarble Race — Stage ${stage.stage}`)
        .setDescription(`The Umarbles head into Stage ${stage.stage}!`)
        .setImage('attachment://umarble_gif.gif'))],
      files: [iconFile(), gifFile()],
    });

    const events = Array.isArray(stage.events) ? stage.events : [];
    if (!events.length) {
      await thread.send({
        embeds: [applyStyle(new EmbedBuilder()
          .setTitle(`Stage ${stage.stage} Update`)
          .setDescription('No significant events this stage.'))],
        files: [iconFile()],
      });
    }

    let cursor = 0;
    while (cursor < events.length) {
      const remaining = events.length - cursor;
      const chunkSize = pickChunkSize(remaining);
      const chunk = events.slice(cursor, cursor + chunkSize);
      cursor += chunkSize;

      // Finish events get their own embed
      for (const evt of chunk.filter(isFinishEvent)) {
        await thread.send({
          embeds: [applyStyle(new EmbedBuilder()
            .setTitle(`Stage ${stage.stage} — Finish!`)
            .setDescription(`🏁 ${evt.msg}`), UMARBLE_GOLD_COLOR)],
          files: [iconFile()],
        });
      }

      const normal = chunk.filter(e => !isFinishEvent(e));
      const eventText = normal.map(e => `• ${e.msg}`).join('\n');
      const delayMs = weightedDelayMs(chunk.length);
      const hasMore = cursor < events.length;
      const tail = hasMore
        ? `\n\nMore from the track ${toRelativeTimestamp(delayMs)}.`
        : '\n\nThat wraps this stage.';

      if (normal.length) {
        if (lastTimedMsg) await clearPriorTimerMessage(lastTimedMsg);
        const posted = await thread.send({
          embeds: [applyStyle(new EmbedBuilder()
            .setTitle(`Stage ${stage.stage} Update`)
            .setDescription(`${eventText}${tail}`))],
          files: [iconFile()],
        });
        lastTimedMsg = hasMore ? posted : null;
      }

      if (hasMore) await sleep(delayMs);
    }

    await thread.send({ embeds: [buildStageLeaderboardEmbed(stage)], files: [iconFile()] });
  }

  // Final results + plot
  const colorMap = Object.fromEntries(
    (racers || []).filter(r => r?.name).map(r => [r.name, r.color || '#000000']),
  );
  let plotAttachment = null;
  try {
    const buffer = await renderRacePlot(raceResult, { weather, colorMap, writeToDisk: false, returnBuffer: true });
    plotAttachment = new AttachmentBuilder(buffer, { name: 'race_plot.png' });
  } catch (e) {
    await thread.send(`Race plot failed to render: ${e.message}`).catch(() => {});
  }

  const finalEmbed = buildFinalResultsEmbed(final);
  if (plotAttachment) {
    finalEmbed.setImage('attachment://race_plot.png');
    await thread.send({ embeds: [finalEmbed], files: [iconFile(), plotAttachment] });
  } else {
    await thread.send({ embeds: [finalEmbed], files: [iconFile()] });
  }

  return final;
}

// ─── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('umarble_race')
    .setDescription('Start a weekly Umarble horse race with a star-betting period!'),

  async execute(interaction) {
    // Defer ephemeral so the command shows "thinking" while we set up
    await interaction.deferReply({ ephemeral: true });

    try {
      const db = await connectToMongo('hilovidsSiteData');
      const campersCol     = db.collection('campers');
      const discordConfigs = db.collection('discordConfigs');
      const racersCol      = db.collection('umarble_racers');
      const playerRacesCol = db.collection('umarble_races');

      const guildId = interaction.guild.id;
      const userId  = interaction.user.id;

      // Parallel fetches
      const [discordConfig, player, allRacerDocs] = await Promise.all([
        discordConfigs.findOne({ server_id: guildId }),
        campersCol.findOne({ discordId: userId }),
        racersCol.find({}).toArray(),
      ]);

      if (!player) {
        return interaction.editReply({ content: 'No player record found. Use /join to register.' });
      }

      // Weekly cooldown check (7 days)
      if (player.lastUmarbleRace) {
        const elapsed = Date.now() - new Date(player.lastUmarbleRace).getTime();
        if (elapsed < 7 * 24 * 60 * 60 * 1000) {
          const nextTs = Math.floor((new Date(player.lastUmarbleRace).getTime() + 7 * 24 * 60 * 60 * 1000) / 1000);
          return interaction.editReply({ content: `You've already started a race this week. You can run another <t:${nextTs}:R>.` });
        }
      }

      // Block if a race is already active in this guild
      const existing = await playerRacesCol.findOne({ guildId, status: { $in: ['betting', 'racing'] } });
      if (existing) {
        return interaction.editReply({
          content: `A race is already in progress in this server!${existing.threadId ? ` Check <#${existing.threadId}>.` : ''}`,
        });
      }

      if (!allRacerDocs.length) {
        return interaction.editReply({ content: 'No racers are registered in the system yet.' });
      }

      // ── Select 6 random horses ──────────────────────────────────────────────
      const shuffled = allRacerDocs.slice().sort(() => Math.random() - 0.5);
      const horses = shuffled.slice(0, Math.min(6, shuffled.length)).map(d => ({
        name:        d.name || 'Unknown',
        stats:       d.stats || {},
        skills:      d.skills || {},
        skillTiming: typeof d.skillTiming === 'number' ? d.skillTiming : 0.5,
        color:       d.color,
        wins:        d.wins   || 0,
        losses:      d.losses || 0,
      }));

      // ── Random race conditions ──────────────────────────────────────────────
      const weathers = ['sunny', 'rainy', 'snowy'];
      const weather     = weathers[Math.floor(Math.random() * 3)];
      const trackLength = randomInt(8, 20) * 100; // 800–2000 m in 100 m steps

      // 3 random obstacles, no duplicate positions
      const obsShuffled = OBSTACLE_POOL.slice().sort(() => Math.random() - 0.5);
      const usedPos = new Set();
      const obstacles = obsShuffled.slice(0, 3).map(obs => {
        const minSlot = Math.ceil(100 / 50);
        const maxSlot = Math.floor((trackLength - 100) / 50);
        let slot = randomInt(minSlot, maxSlot);
        while (usedPos.has(slot)) slot = slot < maxSlot ? slot + 1 : minSlot;
        usedPos.add(slot);
        return { type: obs.type, name: obs.name, pos: slot * 50 };
      });
      obstacles.sort((a, b) => a.pos - b.pos);

      const simOptions = {
        stages:       500,
        trackLength,
        obstacles,
        ticksPerStage: 10,
        weather,
      };

      // ── Odds ────────────────────────────────────────────────────────────────
      const odds = computeOdds(horses, weather);

      // ── Persist race document ───────────────────────────────────────────────
      const bettingClosesAt = Date.now() + BETTING_PERIOD_MS;
      const insertResult = await playerRacesCol.insertOne({
        guildId,
        threadId:       null,   // filled after thread creation
        status:         'betting',
        horses,
        odds,
        simOptions,
        bets:           [],
        bettingClosesAt: new Date(bettingClosesAt),
        initiatorId:    userId,
        startedAt:      new Date(),
      });
      const raceId = insertResult.insertedId.toString();

      // Mark player as having used their weekly slot
      await campersCol.updateOne({ _id: player._id }, { $set: { lastUmarbleRace: new Date() } });

      // ── Announce in the channel ─────────────────────────────────────────────
      const channel = interaction.channel;
      const pingRole = discordConfig?.bot_ping_role_id;
      const pingContent = pingRole
        ? `<@&${pingRole}> 🏁 A Umarble Race is starting!`
        : '🏁 A Umarble Race is starting!';

      const announcementMsg = await channel.send({
        content: pingContent,
        embeds: [applyStyle(new EmbedBuilder()
          .setTitle('🏁 Umarble Race — Starting Soon!')
          .setDescription(
            `<@${userId}> has called a weekly Umarble Race!\n\n` +
            `Betting opens for **5 minutes** in the thread below.\n` +
            `Pick your horse and place your gold star bets!`,
          ))],
        files: [iconFile()],
      });

      // ── Create thread ───────────────────────────────────────────────────────
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const thread = await announcementMsg.startThread({
        name:               `Umarble Race — ${dateStr}`,
        autoArchiveDuration: 1440,
      });

      // Update DB with thread ID
      await playerRacesCol.updateOne(
        { _id: insertResult.insertedId },
        { $set: { threadId: thread.id } },
      );

      // ── Post betting embed in thread ────────────────────────────────────────
      const bettingMsg = await thread.send({
        embeds: [buildBettingEmbed(horses, odds, bettingClosesAt, weather, trackLength, obstacles)],
        files:  [iconFile()],
        components: buildHorseButtons(horses, raceId),
      });

      // Confirm to the command invoker (ephemeral)
      await interaction.editReply({
        content: `Race set up! Betting is open in <#${thread.id}> for 5 minutes. Good luck! 🏇`,
      });

      // ── Wait for betting period ─────────────────────────────────────────────
      await sleep(BETTING_PERIOD_MS);

      // Disable buttons and mark status
      await Promise.allSettled([
        bettingMsg.edit({ components: buildHorseButtons(horses, raceId, true) }),
        playerRacesCol.updateOne({ _id: insertResult.insertedId }, { $set: { status: 'racing' } }),
      ]);

      await thread.send({
        embeds: [applyStyle(new EmbedBuilder()
          .setTitle('🔒 Betting Closed!')
          .setDescription('The gates are about to open — no more bets accepted!'), UMARBLE_SILVER_COLOR)],
        files: [iconFile()],
      });

      // ── Run the race ────────────────────────────────────────────────────────
      const raceResult = runRaceSimulation(horses, simOptions);
      const fullResult  = { ...raceResult, racers: horses, weather };
      const final       = await runRaceInThread(thread, fullResult);

      // ── Determine winner & update stats ─────────────────────────────────────
      const winnerName = final?.[0]?.name ?? null;
      if (winnerName) {
        await Promise.allSettled(
          horses.map(h =>
            racersCol.updateOne({ name: h.name }, { $inc: h.name === winnerName ? { wins: 1 } : { losses: 1 } }),
          ),
        );
      }

      // ── Read bets and pay out ────────────────────────────────────────────────
      const freshDoc = await playerRacesCol.findOne({ _id: insertResult.insertedId });
      const bets = freshDoc?.bets ?? [];

      const payoutLines = [];
      if (winnerName && bets.length) {
        const winnerIdx  = horses.findIndex(h => h.name === winnerName);
        const winnerOdds = winnerIdx >= 0 ? odds[winnerIdx] : 1;
        const winBets    = bets.filter(b => b.horseName === winnerName);

        if (!winBets.length) {
          payoutLines.push('No bets were placed on the winner.');
        } else {
          for (const bet of winBets) {
            const payout  = Math.floor(bet.amount * winnerOdds);
            const profit  = payout - bet.amount;
            try {
              await campersCol.updateOne(
                { discordId: bet.userId },
                { $inc: { 'inventory.stars': payout } },
              );
              payoutLines.push(
                `<@${bet.userId}> bet **${bet.amount}⭐** on **${winnerName}** and won **+${profit}⭐** (paid out ${payout}⭐ at \`${winnerOdds.toFixed(2)}x\`)`,
              );
            } catch (e) {
              console.error('umarble_race payout error', bet.userId, e);
            }
          }
        }
      } else if (!winnerName) {
        payoutLines.push('Could not determine a winner; no payouts issued.');
      } else {
        payoutLines.push('No bets were placed on this race.');
      }

      await thread.send({
        embeds: [applyStyle(new EmbedBuilder()
          .setTitle('💰 Race Payouts')
          .setDescription(payoutLines.join('\n') || 'No payouts this race.')
          .setFooter({ text: 'Thread locked. Thanks for racing!' }), UMARBLE_GOLD_COLOR)],
        files: [iconFile()],
      });

      // ── Finalise ─────────────────────────────────────────────────────────────
      await playerRacesCol.updateOne(
        { _id: insertResult.insertedId },
        { $set: { status: 'complete', completedAt: new Date() } },
      );

      await thread.setLocked(true).catch(e => console.error('thread lock error', e));

    } catch (err) {
      console.error('umarble_race execute error', err);
      try {
        await interaction.editReply({ content: `Something went wrong: ${err.message}` });
      } catch (_) {}
    }
  },
};
