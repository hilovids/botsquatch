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
            const discordConfig = await discordConfigs.findOne({ server_id: interaction.guild.id });
            const embedColor = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000;
            const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;
            if (!inviter) {
                const e = new EmbedBuilder().setTitle('No Profile').setDescription('Could not find your player record. Register with /join first.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }
            if (inviter.eliminated) {
                const e = new EmbedBuilder().setTitle('Eliminated').setDescription('Eliminated players cannot create alliances.').setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

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

            if (!options || options.length === 0) {
                const e = new EmbedBuilder().setTitle('Alliance Created').setDescription(`Alliance created: <#${channel.id}>. No eligible players to invite (same team & not eliminated).`).setColor(embedColor);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            const select = new StringSelectMenuBuilder()
                .setCustomId(`alliance_invite_select:${allianceId}:${inviter.discordId}`)
                .setPlaceholder('Select players to invite')
                .setMinValues(1)
                .setMaxValues(Math.min(10, options.length))
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(select);

            // try to send into inviter's confessional channel first, then DM, then fallback to ephemeral reply
            let sent = false;
            if (inviter.confessionalId) {
                const chan = await interaction.client.channels.fetch(inviter.confessionalId).catch(() => null);
                if (chan) {
                    try { await chan.send({ embeds: [inviteEmbed], components: [row] }); sent = true; } catch (e) { sent = false; }
                }
            }

            if (!sent) {
                // try DM
                try {
                    const userObj = await interaction.client.users.fetch(interaction.user.id).catch(() => null);
                    if (userObj) { await userObj.send({ embeds: [inviteEmbed], components: [row] }); sent = true; }
                } catch (e) { sent = false; }
            }

            if (!sent) {
                // final fallback: send ephemeral reply with the selector
                await interaction.editReply({ content: `Alliance created: <#${channel.id}>. Could not deliver selector to your confessional or DM; here's the selector:`, embeds: [inviteEmbed], components: [row], ephemeral: true });
                return;
            }

            const ok = new EmbedBuilder().setTitle('Alliance Created').setDescription(`Alliance created: <#${channel.id}>. Use the selector in your confessional (or your DMs) to invite players.`).setColor(embedColor);
            if (thumbnail) ok.setThumbnail(thumbnail);
            await interaction.editReply({ embeds: [ok], ephemeral: true });
        } catch (err) {
            console.error('alliance command error', err);
            try {
                const e = new EmbedBuilder().setTitle('Error').setDescription('There was an error creating the alliance.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [e], ephemeral: true });
            } catch (e) {}
        }
    }
};
