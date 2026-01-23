const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coins')
    .setDescription('Show campers ranked by coins (top 25).')
    .addIntegerOption(opt => opt.setName('limit').setDescription('How many top campers to show').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const db = await connectToMongo();
      const campersCol = db.collection('campers');

      const limit = Math.max(1, Math.min(25, interaction.options.getInteger('limit') || 25));

      // fetch top campers by inventory.coins
      const cursor = campersCol.find({}).sort({ 'inventory.coins': -1 }).limit(limit);
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
      const color = discordConfig.embed?.color || '#FFD700';
      const thumb = discordConfig.embed?.thumbnail_url || 'https://imgur.com/mfc6IFp.png';

      const embed = new EmbedBuilder()
        .setTitle(`Campers by Coins (top ${campers.length})`)
        .setColor(color)
        .setTimestamp();

      if (thumb) embed.setThumbnail(thumb);

      const lines = campers.map((c, idx) => {
        const coins = c.inventory && typeof c.inventory.coins !== 'undefined' ? c.inventory.coins : 0;
        const name = c.displayName || c.username || `Unknown (${c.discordId})`;
        return `**${idx + 1}.** ${name} — ${coins} 💰`;
      });

      // Add the house/coinsPool as an extra, non-counted line if present
      try {
        const gCol = db.collection('gambling_state');
        const gDoc = await gCol.findOne({ _id: 'global' });
        if (gDoc && typeof gDoc.coinsPool !== 'undefined') {
          const houseCoins = Number(gDoc.coinsPool) || 0;
          const houseLine = `**House (Coins Pool)** — ${houseCoins} 💰`;
          lines.push('\n' + houseLine);
        }
      } catch (e) {
        console.error('Error fetching gambling_state for house coins:', e);
      }

      // chunk into the embed's description (max length safety)
      embed.setDescription(lines.join('\n'));

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('coins command error', err);
      try { await interaction.editReply({ content: 'There was an error fetching the leaderboard.' }); } catch (e) {}
    }
  }
};
