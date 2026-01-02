const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription("View your player stats: curses, inventory, badges, and more"),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const db = await connectToMongo();
            const campersCol = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');

            const guildId = interaction.guild.id;
            const discordConfig = await discordConfigs.findOne({ server_id: guildId });

            const player = await campersCol.findOne({ discordId: interaction.user.id });
            if (!player) {
                await interaction.editReply({ content: 'No player record found for your account. Use /join to register.', ephemeral: true });
                return;
            }

            const color = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff;

            const embed = new EmbedBuilder()
                .setTitle(`${player.displayName || player.username}'s Stats`)
                .setColor(color)
                .setTimestamp();

            // basic status
            embed.addFields(
                { name: 'Eliminated', value: player.eliminated ? 'Yes' : 'No', inline: true },
            );

            // curses
            const curses = player.curses || {};
            const curseMap = {
                noVote: 'No Vote',
                silent: 'Silent',
                confused: 'Confused'
            };
            const activeCurses = Object.keys(curseMap).filter(k => !!curses[k]).map(k => curseMap[k]);
            embed.addFields({ name: 'Curses', value: activeCurses.length ? activeCurses.join(', ') : 'None' });

            // inventory
            const inv = player.inventory || {};
            const inventoryLines = [];
            const invKeys = [
                ['coins', 'Coins'],
                ['stars', 'Stars'],
                ['voteTokens', 'Vote Tokens'],
                ['immunityTokens', 'Immunity Tokens'],
                ['seanceTokens', 'Seance Tokens'],
                ['timeTokens', 'Time Tokens'],
                ['nothingTokens', 'Nothing Tokens'],
                ['eggToken', 'Egg Tokens']
            ];
            invKeys.forEach(([k, label]) => {
                const v = (typeof inv[k] === 'number') ? inv[k] : 0;
                inventoryLines.push(`${label}: ${v}`);
            });
            embed.addFields({ name: 'Inventory', value: inventoryLines.join('\n') });

            // badges
            const badges = Array.isArray(player.badges) ? player.badges : [];
            embed.addFields({ name: `Badges (${badges.length})`, value: badges.length ? badges.join(', ') : 'None' });

            // optional details
            if (player.pronouns) embed.addFields({ name: 'Pronouns', value: player.pronouns, inline: true });
            if (player.confessionalId) embed.addFields({ name: 'Confessional', value: `<#${player.confessionalId}>`, inline: true });

            await interaction.editReply({ embeds: [embed], ephemeral: true });

        } catch (err) {
            console.error('stats command error', err);
            try { await interaction.editReply({ content: 'There was an error fetching your stats.', ephemeral: true }); } catch (e) {}
        }
    }
};
