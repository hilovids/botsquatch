// Admin command to run a full marble race and post interval updates
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
const { runMarbleRace } = require('../utils/umarble/marbleRaceSim');
const { renderRacePlot } = require('../utils/umarble/plotRace');
// getLatestRaceData now in mongodbUtil.js
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

const UMARBLE_EMBED_COLOR = '#14ae5c';
const UMARBLE_SILVER_COLOR = '#C0C0C0';
const UMARBLE_GOLD_COLOR = '#FFD700';
const UMARBLE_ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'umarble_icon.png');
const UMARBLE_GIF_PATH = path.join(__dirname, '..', '..', 'assets', 'umarble_gif.gif');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickChunkSize(remaining) {
  const maxChunk = Math.min(5, remaining);
  const minChunk = Math.min(3, maxChunk);
  return randomInt(minChunk, maxChunk);
}

function weightedDelayMs(chunkSize) {
  const base = randomInt(10000, 25000);
  const adjustment = (chunkSize - 4) * 1500;
  return Math.max(10000, Math.min(25000, base + adjustment));
  // return 1000;
}

function toRelativeTimestamp(msFromNow) {
  const unix = Math.floor((Date.now() + msFromNow) / 1000);
  return `<t:${unix}:R>`;
}

function applyUmarbleStyle(embed, color = UMARBLE_EMBED_COLOR) {
  return embed
    .setColor(color)
    .setThumbnail('attachment://umarble_icon.png');
}

function iconFile() {
  return new AttachmentBuilder(UMARBLE_ICON_PATH, { name: 'umarble_icon.png' });
}

function gifFile() {
  return new AttachmentBuilder(UMARBLE_GIF_PATH, { name: 'umarble_gif.gif' });
}

function formatStandingLine(entry, idx, fromBottom = false) {
  const place = fromBottom ? `#${idx + 1} from bottom` : `#${idx + 1}`;
  return `${place} • ${entry.name} — ${entry.pos.toFixed(1)}m`;
}

function buildStageLeaderboardEmbed(stage) {
  const sorted = (stage.positions || []).slice().sort((a, b) => b.pos - a.pos);
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();

  const topText = top.length
    ? top.map((entry, idx) => formatStandingLine(entry, idx)).join('\n')
    : 'No racers available';
  const bottomText = bottom.length
    ? bottom.map((entry, idx) => formatStandingLine(entry, idx, true)).join('\n')
    : 'No racers available';

  return applyUmarbleStyle(new EmbedBuilder()
    .setTitle(`Umarble Race - Stage ${stage.stage} Leaderboard`)
    .addFields(
      { name: 'Top 5', value: topText, inline: true },
      { name: 'Bottom 5', value: bottomText, inline: true }
    )
  , UMARBLE_SILVER_COLOR);
}

function buildFinalResultsEmbed(final) {
  return applyUmarbleStyle(new EmbedBuilder()
    .setTitle('Umarble Race Results')
    .setDescription(final.map((r, i) => `**${i + 1}. ${r.name}** - ${r.total.toFixed(1)}m (${r.finishedAt !== Infinity ? `Finished at tick ${r.finishedAt}` : 'DNF'})`).join('\n'))
  , UMARBLE_GOLD_COLOR);
}

function isFinishEvent(evt) {
  if (!evt) return false;
  if (evt.type === 'finish') return true;
  if (typeof evt.msg === 'string' && / finished \(t=\d+\)/i.test(evt.msg)) return true;
  return false;
}

function buildFinishEmbed(stageNumber, eventMsg) {
  return applyUmarbleStyle(new EmbedBuilder()
    .setTitle(`Umarble Race - Stage ${stageNumber} Finish`)
    .setDescription(`🏁 ${eventMsg}`)
  , UMARBLE_GOLD_COLOR);
}

function buildColorMap(racers = []) {
  return Object.fromEntries(racers.filter(r => r && r.name).map(r => [r.name, r.color || '#000000']));
}

function stripCountdownText(description = '') {
  if (typeof description !== 'string') return description;
  return description.replace(/\n\nMore from the track\s*<t:\d+:R>\./i, '');
}

async function clearPriorTimerMessage(message) {
  if (!message || !Array.isArray(message.embeds) || !message.embeds.length) return;
  const source = message.embeds[0];
  const currentDescription = source.description || '';
  const nextDescription = stripCountdownText(currentDescription);
  if (nextDescription === currentDescription) return;

  const updated = new EmbedBuilder()
    .setTitle(source.title || null)
    .setDescription(nextDescription)
    .setColor(source.color || UMARBLE_EMBED_COLOR);

  if (Array.isArray(source.fields) && source.fields.length) {
    updated.addFields(source.fields);
  }
  if (source.footer && source.footer.text) {
    updated.setFooter({ text: source.footer.text, iconURL: source.footer.iconURL || undefined });
  }
  if (source.thumbnail && source.thumbnail.url && !String(source.thumbnail.url).startsWith('attachment://')) {
    updated.setThumbnail(source.thumbnail.url);
  }
  if (source.image && source.image.url && !String(source.image.url).startsWith('attachment://')) {
    updated.setImage(source.image.url);
  }

  await message.edit({ embeds: [updated] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('runmarblerace')
    .setDescription('Admin: Run a full umarble race and post live updates.'),
  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'You do not have permission to run this command.', ephemeral: true });
    }
    await interaction.deferReply();
    let raceResult;
    try {
      raceResult = await runMarbleRace();
    } catch (err) {
      return interaction.editReply('Failed to run race: ' + err.message);
    }

    try {
      const gifEmbed = applyUmarbleStyle(new EmbedBuilder()
        .setTitle('Umarble Race Live')
        .setDescription('The gates are opening...')
        .setImage('attachment://umarble_gif.gif')
      );
      const gifAttachment = new AttachmentBuilder(UMARBLE_GIF_PATH, { name: 'umarble_gif.gif' });
      await interaction.followUp({ embeds: [gifEmbed], files: [iconFile(), gifAttachment] });
    } catch (gifErr) {
      await interaction.followUp({
        embeds: [
          applyUmarbleStyle(new EmbedBuilder()
            .setTitle('Umarble Race Live')
            .setDescription('The gates are opening...')
          )
        ],
        files: [iconFile()]
      });
    }

    const stages = Array.isArray(raceResult.stages) ? raceResult.stages : [];
    let lastTimedUpdateMessage = null;
    for (const stage of stages) {
      await interaction.followUp({
        embeds: [
          applyUmarbleStyle(new EmbedBuilder()
            .setTitle(`Umarble Race - Stage ${stage.stage}`)
            .setDescription(`The Umarbles head into Stage ${stage.stage}!`)
            .setImage('attachment://umarble_gif.gif')
          )
        ],
        files: [iconFile(), gifFile()]
      });

      const events = Array.isArray(stage.events) ? stage.events : [];
      if (!events.length) {
        await interaction.followUp({
          embeds: [
            applyUmarbleStyle(new EmbedBuilder()
              .setTitle(`Umarble Race - Stage ${stage.stage} Update`)
              .setDescription('No significant events this stage.')
            )
          ],
          files: [iconFile()]
        });
      }

      let cursor = 0;
      while (cursor < events.length) {
        const remaining = events.length - cursor;
        const chunkSize = pickChunkSize(remaining);
        const chunk = events.slice(cursor, cursor + chunkSize);
        cursor += chunkSize;

        const finishEvents = chunk.filter(isFinishEvent);
        for (const finishEvt of finishEvents) {
          await interaction.followUp({
            embeds: [buildFinishEmbed(stage.stage, finishEvt.msg)],
            files: [iconFile()]
          });
        }

        const normalEvents = chunk.filter(evt => !isFinishEvent(evt));
        const eventText = normalEvents.map((evt) => `• ${evt.msg}`).join('\n');
        const delayMs = weightedDelayMs(chunk.length);
        const countdown = toRelativeTimestamp(delayMs);
        const hasMore = cursor < events.length;
        const commentaryTail = hasMore
          ? `\n\nMore from the track ${countdown}.`
          : '\n\nThat wraps this stage.';

        if (normalEvents.length) {
          if (lastTimedUpdateMessage) {
            try {
              await clearPriorTimerMessage(lastTimedUpdateMessage);
            } catch (clearErr) {
              // non-fatal; continue posting live updates
            }
          }

          const posted = await interaction.followUp({
            embeds: [
              applyUmarbleStyle(new EmbedBuilder()
                .setTitle(`Umarble Race - Stage ${stage.stage} Update`)
                .setDescription(`${eventText}${commentaryTail}`)
              )
            ],
            files: [iconFile()]
          });

          lastTimedUpdateMessage = hasMore ? posted : null;
        }

        if (hasMore) {
          await sleep(delayMs);
        }
      }

      await interaction.followUp({ embeds: [buildStageLeaderboardEmbed(stage)], files: [iconFile()] });
    }

    const final = Array.isArray(raceResult.final) ? raceResult.final : [];
    const weather = raceResult.weather;
    const colorMap = buildColorMap(raceResult.racers);

    let plotAttachment = null;
    try {
      const buffer = await renderRacePlot(raceResult, {
        weather,
        colorMap,
        writeToDisk: false,
        returnBuffer: true
      });
      plotAttachment = new AttachmentBuilder(buffer, { name: 'race_plot.png' });
    } catch (plotErr) {
      await interaction.followUp(`Race plot failed to render: ${plotErr.message}`);
    }

    const summaryEmbed = buildFinalResultsEmbed(final);
    if (plotAttachment) {
      summaryEmbed.setImage('attachment://race_plot.png');
      await interaction.followUp({ embeds: [summaryEmbed], files: [iconFile(), plotAttachment] });
    } else {
      await interaction.followUp({ embeds: [summaryEmbed], files: [iconFile()] });
    }
  }
};
