const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { ObjectId } = require('mongodb');

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
                const e = new EmbedBuilder().setTitle('Not An Alliance').setDescription('This channel is not an alliance channel.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            const sub = interaction.options.getSubcommand();
            const member = await campersCol.findOne({ discordId: interaction.user.id });
            if (!member) {
                const e = new EmbedBuilder().setTitle('No Profile').setDescription('You do not have a player record.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            if (sub === 'invite') {
                const targetUser = interaction.options.getUser('user');
                if (!targetUser) {
                    const e = new EmbedBuilder().setTitle('Invalid Target').setDescription('Invalid target.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }
                if (String(targetUser.id) === String(interaction.user.id)) {
                    const e = new EmbedBuilder().setTitle('Invalid Invite').setDescription('You cannot invite yourself.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }

                const target = await campersCol.findOne({ discordId: targetUser.id, eliminated: { $ne: true } });
                if (!target) {
                    const e = new EmbedBuilder().setTitle('Invalid Target').setDescription('Target is not a valid camper or is eliminated.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }

                // ensure inviter can view the channel and is not eliminated
                const perms = channel.permissionsFor(interaction.user);
                if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) {
                    const e = new EmbedBuilder().setTitle('Not A Member').setDescription('You are not a member of this alliance.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }
                if (member.eliminated) {
                    const e = new EmbedBuilder().setTitle('Eliminated').setDescription('Eliminated campers cannot send invites.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }

                // find alliance record in DB
                const alliance = await alliances.findOne({ channelId, guildId: interaction.guild.id, active: true });
                if (!alliance) {
                    const e = new EmbedBuilder().setTitle('Not Managed').setDescription('This channel is not a managed alliance.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }

                const inviteObj = { _id: new ObjectId(), discordId: targetUser.id, inviterId: interaction.user.id, message: `You are invited to join alliance ${alliance.name}`, createdAt: new Date(), expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)), status: 'pending' };
                await alliances.updateOne({ _id: alliance._id }, { $push: { invites: inviteObj } });

                const inviteEmbed = new EmbedBuilder()
                    .setTitle(`Alliance Invite: ${alliance.name}`)
                    .setDescription(inviteObj.message)
                    .addFields({ name: 'Invited By', value: `${interaction.user.username}` })
                    .setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00AE86)
                    .setTimestamp();

                const acceptId = `alliance_invite_accept:${String(alliance._id)}:${inviteObj._id}`;
                const declineId = `alliance_invite_decline:${String(alliance._id)}:${inviteObj._id}`;
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

                const ok = new EmbedBuilder().setTitle('Invite Sent').setDescription(`Invite sent to ${target.displayName || target.username || targetUser.tag}.`).setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff);
                await interaction.editReply({ embeds: [ok], ephemeral: true });
                return;
            }

            if (sub === 'leave') {
                // ensure member
                const perms = channel.permissionsFor(interaction.user);
                if (!perms || !perms.has(PermissionFlagsBits.ViewChannel)) {
                    const e = new EmbedBuilder().setTitle('Not A Member').setDescription('You are not a member of this alliance.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }

                // remove from alliance members in DB and remove user's overwrite
                const alliance = await alliances.findOne({ channelId, guildId: interaction.guild.id, active: true });
                if (alliance) {
                    await alliances.updateOne({ _id: alliance._id }, { $pull: { members: interaction.user.id } });
                }
                try { await channel.permissionOverwrites.delete(interaction.user.id).catch(() => {}); } catch (e) { }

                // if no non-bot members remain with view access, archive alliance and delete channel
                let shouldDeleteChannel = false;
                try {
                    await channel.fetch();
                    const humanMembers = channel.members.filter(m => !m.user.bot);
                    if (!humanMembers || humanMembers.size === 0) {
                        shouldDeleteChannel = true;
                        if (alliance) await alliances.updateOne({ _id: alliance._id }, { $set: { active: false, closedAt: new Date() } });
                    }
                } catch (e) {}

                // reply to the interaction before attempting to delete the channel (deleting the channel invalidates the original interaction message)
                const ok = new EmbedBuilder().setTitle('Left Alliance').setDescription('You left the alliance.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff);
                await interaction.editReply({ embeds: [ok], ephemeral: true });

                if (shouldDeleteChannel) {
                    // delete channel in background
                    channel.delete().catch(() => {});
                }

                return;
            }

        } catch (err) {
            console.error('alliancemember command error', err);
            try { await interaction.editReply({ content: 'There was an error running the command.', ephemeral: true }); } catch (e) {}
        }
    }
};
