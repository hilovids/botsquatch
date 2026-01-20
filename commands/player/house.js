const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getResources } = require('../../utils/houseManager');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('house')
        .setDescription("Show the house's gambling resources and stats"),

    async execute(interaction) {
        const db = await connectToMongo();
        async function getDiscordConfig(db, guildId) {
            const discordConfigs = db.collection('discordConfigs');
            return await discordConfigs.findOne({ server_id: guildId });
        }
        const discordConfig = await getDiscordConfig(db, interaction.guildId);
        const embedColor = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff;
        const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;

        await interaction.deferReply({ ephemeral: false });
        try {
            const res = await getResources();
            if (!res) {
                const noRes = new EmbedBuilder().setTitle('House Resources').setDescription('House resources not available.').setColor(embedColor);
                await interaction.editReply({ embeds: [noRes], ephemeral: true });
                return;
            }

            // stats in gambling_state record are tracked from the player's perspective
            // for the house view we flip wins/losses (house wins = player losses)
            const cardHouseWins = (res.stats.cardLosses || 0);
            const cardHouseLosses = (res.stats.cardWins || 0);
            const bjHouseWins = (res.stats.bjLosses || 0);
            const bjHouseLosses = (res.stats.bjWins || 0);
            const rpsHouseWins = (res.stats.rpsLosses || 0);
            const rpsHouseLosses = (res.stats.rpsWins || 0);

            // show only the issuer's gamblePool so they know how much they could still win today
            const campersCol = db.collection('campers');
            const issuer = await campersCol.findOne({ discordId: interaction.user.id });
            const issuerPool = issuer && typeof issuer.gamblePool === 'number' ? issuer.gamblePool : 30;

            const embed = new EmbedBuilder().setTitle("House Resources").setColor(embedColor).setThumbnail(thumbnail || '')
                .addFields(
                    { name: 'Payouts', value: `Card: ${res.payouts.card.multiplier}x\nBlackjack: ${res.payouts.blackjack.multiplier}x\nRPS: ${res.payouts.rps.multiplier}x`, inline: true },
                    { name: 'RPSH Cards', value: `${res.counts.rocks + res.counts.papers + res.counts.scissors + res.counts.elderHand}`, inline: true },
                    { name: 'Star Pool', value: String(res.starsPool), inline: false }
                )
                .addFields(
                    { name: 'House Stats (W/L)', value: `Card: ${cardHouseWins}/${cardHouseLosses}\nBlackjack: ${bjHouseWins}/${bjHouseLosses}\nRPS: ${rpsHouseWins}/${rpsHouseLosses}\nTotal Payouts: ${res.stats.totalPayouts || 0}`, inline: false }
                )
                // include only the command issuer's gamble pool
                .addFields(
                    { name: 'Your Gamble Pool (earnable stars)', value: String(issuerPool), inline: false }
                )
                .setFooter({ text: `Last Cashout: ${res.lastPayoutAt ? new Date(res.lastPayoutAt).toUTCString() : 'never'}` });

            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error('house command error', e);
            try { await interaction.editReply({ content: 'There was an error fetching house resources.', ephemeral: true }); } catch (e) { }
        }
    }
};
