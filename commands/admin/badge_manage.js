const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { addBadges, removeBadges, listBadges } = require('../../utils/badgeManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('badge_manage')
    .setDescription('Admin: add, remove, or list player badges')
    .addStringOption((opt) =>
      opt.setName('action')
        .setDescription('Operation to perform')
        .setRequired(true)
        .addChoices(
          { name: 'Add', value: 'add' },
          { name: 'Remove', value: 'remove' },
          { name: 'List', value: 'list' },
        ),
    )
    .addUserOption((opt) =>
      opt.setName('user')
        .setDescription('Target Discord user (preferred)')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('username')
        .setDescription('Target username (fallback)')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('badge')
        .setDescription('Badge id/name or comma-separated list (for add/remove)')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const action = interaction.options.getString('action', true);
      const user = interaction.options.getUser('user');
      const username = interaction.options.getString('username');
      const badgeInput = interaction.options.getString('badge');

      if (!user && !username) {
        await interaction.editReply({ content: 'Provide either user or username.' });
        return;
      }

      const db = await connectToMongo('hilovidsSiteData');
      const campersCol = db.collection('campers');
      const userQuery = user ? { discordId: user.id } : { username: username };
      const label = user ? (user.username || user.id) : username;

      if (action === 'list') {
        const result = await listBadges(campersCol, userQuery);
        if (!result.ok) {
          await interaction.editReply({ content: `Player not found: ${label}` });
          return;
        }
        await interaction.editReply({
          content: `Badges for ${label}: ${result.badges.length ? result.badges.join(', ') : 'None'}`,
        });
        return;
      }

      if (!badgeInput) {
        await interaction.editReply({ content: 'badge is required for add/remove.' });
        return;
      }

      const result = action === 'add'
        ? await addBadges(campersCol, userQuery, badgeInput)
        : await removeBadges(campersCol, userQuery, badgeInput);

      if (result.reason === 'user-not-found' || result.matchedCount === 0) {
        await interaction.editReply({ content: `Player not found: ${label}` });
        return;
      }

      if (result.reason === 'no-valid-badges') {
        await interaction.editReply({ content: 'No valid badges provided.' });
        return;
      }

      await interaction.editReply({
        content: [
          `Action: ${action}`,
          `Target: ${label}`,
          `Applied: ${result.appliedBadges.join(', ') || 'None'}`,
          `Invalid: ${result.invalidBadges.join(', ') || 'None'}`,
          `Current: ${result.badges.join(', ') || 'None'}`,
        ].join('\n'),
      });
    } catch (err) {
      console.error('badge_manage command error', err);
      try {
        await interaction.editReply({ content: 'There was an error running badge_manage.' });
      } catch (_) {}
    }
  },
};
