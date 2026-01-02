const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('token')
        .setDescription('Use a special token (immunity, seance, time, nothing, egg)')
        .addStringOption(opt => opt.setName('type').setDescription('Token type to use').setRequired(true)
            .addChoices(
                { name: 'Immunity', value: 'immunity' },
                { name: 'Seance', value: 'seance' },
                { name: 'Time', value: 'time' },
                { name: 'Nothing', value: 'nothing' },
                { name: 'Egg', value: 'egg' }
            )),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const type = interaction.options.getString('type');
        // If egg is selected, prompt user with a modal to collect target
        if (type === 'egg') {
            // check active ceremony first
            const db = await connectToMongo();
            const ceremoniesCol = db.collection('ceremonies');
            const ceremony = await ceremoniesCol.findOne({ guildId, active: true });
            if (!ceremony) {
                await interaction.reply({ content: 'Egg tokens can only be used during an active elimination.', ephemeral: true });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('token_egg_modal')
                .setTitle('Use Egg Token')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('egg_target').setLabel('Target camper (username or id)').setStyle(TextInputStyle.Short).setRequired(true)
                    )
                );

            await interaction.showModal(modal);
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const db = await connectToMongo();
            const campersCol = db.collection('campers');
            const ceremoniesCol = db.collection('ceremonies');
            const discordConfigs = db.collection('discordConfigs');

            const discordConfig = await discordConfigs.findOne({ server_id: guildId });

            const voter = await campersCol.findOne({ discordId: userId });
            if (!voter) {
                await interaction.editReply({ content: 'Could not find your player record.', ephemeral: true });
                return;
            }

            // map token types to inventory keys
            const tokenKeyMap = {
                immunity: 'immunityTokens',
                seance: 'seanceTokens',
                time: 'timeTokens',
                nothing: 'nothingTokens',
                egg: 'eggToken'
            };

            const invKey = tokenKeyMap[type];
            if (!invKey) {
                await interaction.editReply({ content: 'Invalid token type.', ephemeral: true });
                return;
            }

            const available = (voter.inventory && typeof voter.inventory[invKey] === 'number') ? voter.inventory[invKey] : 0;
            if (available <= 0) {
                await interaction.editReply({ content: `You do not have any ${type} token(s) to use.`, ephemeral: true });
                return;
            }

            // find active ceremony if applicable
            const ceremony = await ceremoniesCol.findOne({ guildId, active: true });

            // helper to send anonymous token-used embed to campground
            async function sendAnonymousEmbed(color = 0xFEB316) {
                const Embed = new EmbedBuilder().setTitle('A token has been used!').setColor(color);
                const campId = discordConfig && discordConfig.campground_id;
                if (campId) {
                    try {
                        const chan = await interaction.client.channels.fetch(campId);
                        if (chan) await chan.send({ embeds: [Embed] });
                    } catch (e) { console.error('sendAnonymousEmbed error', e); }
                }
            }

            // handle each token type
            if (type === 'immunity') {
                // only during elimination
                if (!ceremony) {
                    await interaction.editReply({ content: 'Immunity tokens can only be used during an active elimination.', ephemeral: true });
                    return;
                }

                // record in ceremony.tokens
                await ceremoniesCol.updateOne({ _id: ceremony._id }, { $push: { tokens: { type: 'immunity', userId: userId, createdAt: new Date() } } }, { upsert: true });

                // decrement token
                await campersCol.updateOne({ _id: voter._id }, { $inc: { ['inventory.' + invKey]: -1 } });

                await sendAnonymousEmbed(discordConfig.embed.color);

                const updated = await campersCol.findOne({ _id: voter._id });
                const remaining = (updated.inventory && updated.inventory[invKey]) ? updated.inventory[invKey] : 0;
                await interaction.editReply({ content: `Immunity token used. You have ${remaining} remaining.`, ephemeral: true });
                return;
            }

            if (type === 'seance') {
                // create a private channel for the user + spectator role
                const guild = interaction.guild;
                const seanceCat = discordConfig && (discordConfig.seance_category_id || discordConfig.seance_category);
                const spectatorRole = discordConfig && (discordConfig.spectator_role_id || discordConfig.spectator_role);

                // create channel name safe
                const baseName = `seance-${interaction.user.username.replace(/[^a-z0-9-_]/gi, '_').toLowerCase()}`;

                try {
                    const permissionOverwrites = [
                        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                    ];
                    if (spectatorRole) permissionOverwrites.push({ id: spectatorRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

                    const channel = await guild.channels.create({ name: baseName, type: ChannelType.GuildText, parent: seanceCat || null, permissionOverwrites });

                    // decrement token
                    await campersCol.updateOne({ _id: voter._id }, { $inc: { ['inventory.' + invKey]: -1 } });

                    // if used during elimination, send anonymous embed
                    if (ceremony) await sendAnonymousEmbed(discordConfig.embed.color);

                    const updated = await campersCol.findOne({ _id: voter._id });
                    const remaining = (updated.inventory && updated.inventory[invKey]) ? updated.inventory[invKey] : 0;

                    await interaction.editReply({ content: `Seance created: <#${channel.id}>. You have ${remaining} remaining.`, ephemeral: true });
                    return;
                } catch (e) {
                    console.error('seance token error', e);
                    await interaction.editReply({ content: 'There was an error creating the seance channel.', ephemeral: true });
                    return;
                }
            }

            if (type === 'time') {
                // cannot be used during elimination
                if (ceremony) {
                    await interaction.editReply({ content: 'Time tokens cannot be used during an active elimination.', ephemeral: true });
                    return;
                }

                // send message in confessional to user and production role
                const confId = voter.confessionalId;
                const productionRole = discordConfig && (discordConfig.production_role_id || discordConfig.production_role);
                try {
                    if (confId) {
                        const chan = await interaction.client.channels.fetch(confId);
                        if (chan) {
                            const msg = `Your time token has been redeemed. You will receive additional time during your next challenge.`;
                            await chan.send({ content: `${productionRole ? `<@&${productionRole}> ` : ''}${msg}` });
                        }
                    }

                    // decrement token
                    await campersCol.updateOne({ _id: voter._id }, { $inc: { ['inventory.' + invKey]: -1 } });

                    const updated = await campersCol.findOne({ _id: voter._id });
                    const remaining = (updated.inventory && updated.inventory[invKey]) ? updated.inventory[invKey] : 0;
                    await interaction.editReply({ content: `Time token used. Production notified. You have ${remaining} remaining.`, ephemeral: true });
                    return;
                } catch (e) {
                    console.error('time token error', e);
                    await interaction.editReply({ content: 'There was an error notifying production.', ephemeral: true });
                    return;
                }
            }

            if (type === 'nothing') {
                // can be used anytime; if during elimination send anonymous embed
                // decrement token
                await campersCol.updateOne({ _id: voter._id }, { $inc: { ['inventory.' + invKey]: -1 } });

                if (ceremony) await sendAnonymousEmbed(discordConfig.embed.color);

                const updated = await campersCol.findOne({ _id: voter._id });
                const remaining = (updated.inventory && updated.inventory[invKey]) ? updated.inventory[invKey] : 0;
                await interaction.editReply({ content: `Nothing token used. You have ${remaining} remaining.`, ephemeral: true });
                return;
            }

        } catch (err) {
            console.error('token command error', err);
            try { await interaction.editReply({ content: 'There was an error using your token.', ephemeral: true }); } catch (e) {}
        }
    }
};
