const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stars')
    .setDescription('Show campers ranked by stars (top 25).')
    .addIntegerOption(opt => opt.setName('limit').setDescription('How many top campers to show').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const db = await connectToMongo();
      const campersCol = db.collection('campers');
      const configCol = db.collection('discordConfig');

      const limit = Math.max(1, Math.min(25, interaction.options.getInteger('limit') || 25));

      // fetch top campers by inventory.stars
      const cursor = campersCol.find({}).sort({ 'inventory.stars': -1 }).limit(limit);
      const campers = await cursor.toArray();

      if (!campers || campers.length === 0) {
        await interaction.editReply({ content: 'No campers found.' });
        return;
      }

      async function getDiscordConfig(db, guildId) {
          const discordConfigs = db.collection('discordConfigs');
          return await discordConfigs.findOne({ server_id: guildId });
      }

      // fetch discordConfig document (assume single doc)
      const discordConfig = await getDiscordConfig(db, interaction.guildId);
      const color = discordConfig.embed?.color || '#41FEBA';
      const thumb = discordConfig.embed?.thumbnail_url || 'https://imgur.com/mfc6IFp.png';

      const embed = new EmbedBuilder()
        .setTitle(`Campers by Stars (top ${campers.length})`)
        .setColor(color)
        .setTimestamp();

      if (thumb) embed.setThumbnail(thumb);

      const lines = campers.map((c, idx) => {
        const stars = c.inventory && typeof c.inventory.stars !== 'undefined' ? c.inventory.stars : 0;
        const name = c.displayName || c.username || `Unknown (${c.discordId})`;
        return `**${idx + 1}.** ${name} — ${stars} ⭐`;
      });

      // Add the house/starsPool as an extra, non-counted line
      try {
        const gCol = db.collection('gambling_state');
        const gDoc = await gCol.findOne({ _id: 'global' });
        if (gDoc && typeof gDoc.starsPool !== 'undefined') {
          const houseStars = Number(gDoc.starsPool) || 0;
          const houseLine = `**House (Stars Pool)** — ${houseStars} ⭐`;
          lines.push('\n' + houseLine);
        }
      } catch (e) {
        console.error('Error fetching gambling_state for house stars:', e);
      }

      // chunk into the embed's description (max length safety)
      embed.setDescription(lines.join('\n'));

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('stars command error', err);
      try { await interaction.editReply({ content: 'There was an error fetching the leaderboard.' }); } catch (e) {}
    }
  }
};
