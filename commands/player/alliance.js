const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

function sanitizeName(name) {
    return name.replace(/[^a-z0-9-_]/gi, '-').toLowerCase().slice(0, 90);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('alliance')
        .setDescription('Create an alliance channel and invite players')
        .addStringOption(opt => opt.setName('name').setDescription('Alliance name').setRequired(true))
        .addStringOption(opt => opt.setName('message').setDescription('Invite message').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const db = await connectToMongo();
            const campersCol = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');
            const alliancesCol = db.collection('alliances');

            const inviter = await campersCol.findOne({ discordId: interaction.user.id });
            if (!inviter) return await interaction.editReply({ content: 'Could not find your player record. Register with /join first.', ephemeral: true });
            if (inviter.eliminated) return await interaction.editReply({ content: 'Eliminated players cannot create alliances.', ephemeral: true });

            const discordConfig = await discordConfigs.findOne({ server_id: interaction.guild.id });

            const name = interaction.options.getString('name');
            const msg = interaction.options.getString('message');

            const channelName = `alliance-${sanitizeName(name)}`;

            // create channel
            const guild = interaction.guild;
            const allianceCatId = discordConfig && (discordConfig.alliance_category_id || null);

            // verify category exists in this guild; fallback to no parent if not
            let parent = null;
            if (allianceCatId) {
                try {
                    const cat = await guild.channels.fetch(allianceCatId).catch(() => null);
                    if (cat && cat.type === ChannelType.GuildCategory) parent = allianceCatId;
                } catch (e) { parent = null; }
            }

            // spectator and production roles from config
            const spectatorRole = discordConfig && (discordConfig.spectator_role_id || discordConfig.spectator_role);
            const productionRole = discordConfig && (discordConfig.production_role_id || discordConfig.production_role);

            const permissionOverwrites = [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ];
            if (spectatorRole) permissionOverwrites.push({ id: spectatorRole, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] });
            if (productionRole) permissionOverwrites.push({ id: productionRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

            const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: parent || null, permissionOverwrites });

            // create alliance record
            const allianceDoc = {
                guildId: interaction.guild.id,
                channelId: channel.id,
                name,
                ownerId: interaction.user.id,
                members: [interaction.user.id],
                invites: [],
                createdAt: new Date(),
                active: true
            };

            const res = await alliancesCol.insertOne(allianceDoc);
            const allianceId = res.insertedId.toString();

            // send a message in inviter's confessional with a user select to pick invitees
            const inviteEmbed = new EmbedBuilder()
                .setTitle(`Alliance: ${name}`)
                .setDescription(msg)
                .addFields({ name: 'Inviter', value: `${inviter.displayName || inviter.username}` })
                .setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00AE86)
                .setTimestamp();

            // build a filtered select menu of up to 25 eligible campers (same team, not eliminated)
            const eligible = await campersCol.find({ eliminated: { $ne: true }, team: inviter.team, discordId: { $ne: inviter.discordId } }).limit(25).toArray();
            const options = eligible.map(c => ({ label: (c.displayName || c.username || c.discordId).slice(0, 100), value: String(c.discordId) }));

            const select = new StringSelectMenuBuilder()
                .setCustomId(`alliance_invite_select:${allianceId}:${inviter.discordId}`)
                .setPlaceholder('Select players to invite')
                .setMinValues(1)
                .setMaxValues(Math.min(10, options.length))
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(select);

            // send into inviter's confessional channel if available, otherwise reply ephemeral
            if (inviter.confessionalId) {
                const chan = await interaction.client.channels.fetch(inviter.confessionalId).catch(() => null);
                if (chan) {
                    await chan.send({ embeds: [inviteEmbed], components: [row] }).catch(() => {});
                }
            }

            await interaction.editReply({ content: `Alliance created: <#${channel.id}>. Use the selector in your confessional to invite players.`, ephemeral: true });
        } catch (err) {
            console.error('alliance command error', err);
            try { await interaction.editReply({ content: 'There was an error creating the alliance.', ephemeral: true }); } catch (e) {}
        }
    }
};
