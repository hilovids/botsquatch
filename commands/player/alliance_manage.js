const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('alliancemember')
        .setDescription('Manage membership for the current alliance channel')
        .addSubcommand(sub => sub.setName('invite').setDescription('Invite a player to this alliance').addUserOption(opt => opt.setName('user').setDescription('Player to invite').setRequired(true)))
        .addSubcommand(sub => sub.setName('leave').setDescription('Leave the alliance channel you are in')),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        try {
            const db = await connectToMongo();
            const alliances = db.collection('alliances');
            const campersCol = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');
            const discordConfig = await discordConfigs.findOne({ server_id: interaction.guild.id });

            const channel = interaction.channel;
            const channelId = channel.id;
            // basic check: alliance channels are named starting with 'alliance-' or in alliance category
            const allianceCatId = discordConfig && (discordConfig.alliance_category_id || null);
            if (!(channel.name && channel.name.startsWith('alliance-')) && String(channel.parentId) !== String(allianceCatId)) {
                return await interaction.editReply({ content: 'This channel is not an alliance channel.', ephemeral: true });
            }

            const sub = interaction.options.getSubcommand();
            const member = await campersCol.findOne({ discordId: interaction.user.id });
            if (!member) return await interaction.editReply({ content: 'You do not have a player record.', ephemeral: true });

            if (sub === 'invite') {
                const targetUser = interaction.options.getUser('user');
                if (!targetUser) return await interaction.editReply({ content: 'Invalid target.', ephemeral: true });
                if (String(targetUser.id) === String(interaction.user.id)) return await interaction.editReply({ content: 'You cannot invite yourself.', ephemeral: true });

                const target = await campersCol.findOne({ discordId: targetUser.id, eliminated: { $ne: true } });
                if (!target) return await interaction.editReply({ content: 'Target is not a valid camper or is eliminated.', ephemeral: true });

                // ensure inviter can view the channel
                const perms = channel.permissionsFor(interaction.user);
                if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) return await interaction.editReply({ content: 'You are not a member of this alliance.', ephemeral: true });

                const ts = String(Date.now());
                const acceptId = `alliance_invite_accept:${channelId}:${targetUser.id}:${interaction.user.id}:${ts}`;
                const declineId = `alliance_invite_decline:${channelId}:${targetUser.id}:${interaction.user.id}:${ts}`;

                const inviteEmbed = new EmbedBuilder()
                    .setTitle(`Alliance Invite: ${channel.name}`)
                    .setDescription(`You are invited to join ${channel.name}`)
                    .addFields({ name: 'Invited By', value: `${interaction.user.username}` })
                    .setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00AE86)
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger)
                );

                const pingContent = `<@${targetUser.id}>`;
                if (target.confessionalId) {
                    const chan = await interaction.client.channels.fetch(target.confessionalId).catch(() => null);
                    if (chan) await chan.send({ content: pingContent, embeds: [inviteEmbed], components: [row] }).catch(() => null);
                } else {
                    const userObj = await interaction.client.users.fetch(targetUser.id).catch(() => null);
                    if (userObj) await userObj.send({ content: pingContent, embeds: [inviteEmbed], components: [row] }).catch(() => null);
                }

                await interaction.editReply({ content: `Invite sent to ${target.displayName || target.username || targetUser.tag}.`, ephemeral: true });
                return;
            }

            if (sub === 'leave') {
                // ensure member
                const perms = channel.permissionsFor(interaction.user);
                if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) return await interaction.editReply({ content: 'You are not a member of this alliance.', ephemeral: true });

                // remove user's overwrite
                try { await channel.permissionOverwrites.delete(interaction.user.id).catch(() => {}); } catch (e) { }

                // if no non-bot members remain with view access, delete channel
                try {
                    await channel.fetch();
                    const humanMembers = channel.members.filter(m => !m.user.bot);
                    if (!humanMembers || humanMembers.size === 0) {
                        await channel.delete().catch(() => {});
                    }
                } catch (e) {}

                await interaction.editReply({ content: 'You left the alliance.', ephemeral: true });
                return;
            }

        } catch (err) {
            console.error('alliancemember command error', err);
            try { await interaction.editReply({ content: 'There was an error running the command.', ephemeral: true }); } catch (e) {}
        }
    }
};
