const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Give tokens or coins to another player')
        .addStringOption(opt => opt.setName('item').setDescription('Item to give').setRequired(true)
            .addChoices(
                { name: 'Coins', value: 'coins' },
                { name: 'Immunity Token', value: 'immunityTokens' },
                { name: 'Seance Token', value: 'seanceTokens' },
                { name: 'Time Token', value: 'timeTokens' },
                { name: 'Nothing Token', value: 'nothingTokens' },
                { name: 'Egg Token', value: 'eggToken' },
                { name: 'Stars', value: 'stars' }
            ))
        .addIntegerOption(opt => opt.setName('quantity').setDescription('Quantity to give').setRequired(true).setMinValue(1))
        .addUserOption(opt => opt.setName('target').setDescription('Player to receive the item').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const userId = interaction.user.id;

        try {
            const db = await connectToMongo();
            const campersCol = db.collection('campers');

            const sender = await campersCol.findOne({ discordId: userId });
            const discordConfigs = db.collection('discordConfigs');
            const discordConfig = await discordConfigs.findOne({ server_id: guildId });
            const embedColor = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000;
            const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;
            if (!sender) {
                const e = new EmbedBuilder().setTitle('No Profile').setDescription('Could not find your player record. Please register with /join first.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }
            if (sender.eliminated) {
                const e = new EmbedBuilder().setTitle('Eliminated').setDescription('Eliminated players cannot trade.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            const targetUser = interaction.options.getUser('target');
            if (!targetUser) {
                const e = new EmbedBuilder().setTitle('Invalid Target').setDescription('Invalid target user.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            if (targetUser.id === userId) {
                const e = new EmbedBuilder().setTitle('Invalid Trade').setDescription('You cannot send items to yourself.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            const target = await campersCol.findOne({ discordId: targetUser.id });
            if (!target) {
                const e = new EmbedBuilder().setTitle('No Target Profile').setDescription('Target player does not have a player record.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            if (target.eliminated) {
                const e = new EmbedBuilder().setTitle('Invalid Target').setDescription('You cannot send items to an eliminated player.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            const item = interaction.options.getString('item');
            const quantity = interaction.options.getInteger('quantity');

            if (!item || !quantity || quantity < 1) {
                const e = new EmbedBuilder().setTitle('Invalid Input').setDescription('Invalid item or quantity.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            const available = (sender.inventory && typeof sender.inventory[item] === 'number') ? sender.inventory[item] : 0;
            if (available < quantity) {
                const e = new EmbedBuilder().setTitle('Insufficient Items').setDescription(`You only have ${available} ${item.replace(/([A-Z])/g, ' $1').toLowerCase()}.`).setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            // perform transfer
            await campersCol.updateOne({ _id: sender._id }, { $inc: { ['inventory.' + item]: -quantity } });
            await campersCol.updateOne({ _id: target._id }, { $inc: { ['inventory.' + item]: quantity } });

            const updatedSender = await campersCol.findOne({ _id: sender._id });
            const updatedTarget = await campersCol.findOne({ _id: target._id });
            const senderNew = (updatedSender.inventory && typeof updatedSender.inventory[item] === 'number') ? updatedSender.inventory[item] : 0;
            const targetNew = (updatedTarget.inventory && typeof updatedTarget.inventory[item] === 'number') ? updatedTarget.inventory[item] : 0;

            const itemLabels = {
                coins: 'coin(s)',
                immunityTokens: 'Immunity Token(s)',
                seanceTokens: 'Seance Token(s)',
                timeTokens: 'Time Token(s)',
                nothingTokens: 'Nothing Token(s)',
                eggToken: 'Egg Token(s)',
                stars: 'star(s)' // Added stars to the item labels
            };

            const label = itemLabels[item] || item;

            const embed = new EmbedBuilder()
                .setTitle('Trade Completed')
                .setDescription(`${sender.displayName || sender.username} sent ${quantity} ${label} to ${target.displayName || target.username}.`)
                .setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00AE86)
                .addFields(
                    { name: `${sender.displayName || sender.username}`, value: `New ${label}: **${senderNew}**`, inline: true },
                    { name: `${target.displayName || target.username}`, value: `New ${label}: **${targetNew}**`, inline: true }
                )
                .setTimestamp();

            // helper to deliver embed to a player via confessional channel or DM
            async function deliverEmbedToPlayer(playerDoc, discordId) {
                try {
                    if (playerDoc && playerDoc.confessionalId) {
                        const chan = await interaction.client.channels.fetch(playerDoc.confessionalId).catch(() => null);
                        if (chan) return await chan.send({ embeds: [embed] }).catch(() => null);
                    }
                    const userObj = await interaction.client.users.fetch(discordId).catch(() => null);
                    if (userObj) return await userObj.send({ embeds: [embed] }).catch(() => null);
                } catch (e) { console.error('deliverEmbedToPlayer error', e); }
            }

            await deliverEmbedToPlayer(updatedSender, userId);
            await deliverEmbedToPlayer(updatedTarget, targetUser.id);

            const replyEmbed = new EmbedBuilder().setTitle('Trade Sent').setDescription(`${sender.displayName || sender.username} sent ${quantity} ${label} to ${target.displayName || target.username}.`).setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff).addFields({ name: 'Your new total', value: `${senderNew}` }, { name: 'Recipient new total', value: `${targetNew}` });
            await interaction.editReply({ embeds: [replyEmbed], ephemeral: true });

        } catch (err) {
            console.error('trade command error', err);
            try {
                const e = new EmbedBuilder().setTitle('Error').setDescription('There was an error processing the trade.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [e], ephemeral: true });
            } catch (e) {}
        }
    }
};
