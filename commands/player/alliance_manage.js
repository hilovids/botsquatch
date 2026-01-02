const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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

            const channelId = interaction.channel.id;
            const alliance = await alliances.findOne({ channelId, guildId: interaction.guild.id, active: true });
            if (!alliance) return await interaction.editReply({ content: 'This channel is not an active alliance.', ephemeral: true });

            const sub = interaction.options.getSubcommand();
            const member = await campersCol.findOne({ discordId: interaction.user.id });
            if (!member) return await interaction.editReply({ content: 'You do not have a player record.', ephemeral: true });

            if (sub === 'invite') {
                const targetUser = interaction.options.getUser('user');
                if (!targetUser) return await interaction.editReply({ content: 'Invalid target.', ephemeral: true });
                if (String(targetUser.id) === String(interaction.user.id)) return await interaction.editReply({ content: 'You cannot invite yourself.', ephemeral: true });

                const target = await campersCol.findOne({ discordId: targetUser.id, eliminated: { $ne: true } });
                if (!target) return await interaction.editReply({ content: 'Target is not a valid camper or is eliminated.', ephemeral: true });

                // ensure inviter is a member
                if (!Array.isArray(alliance.members) || !alliance.members.includes(interaction.user.id)) return await interaction.editReply({ content: 'You are not a member of this alliance.', ephemeral: true });

                const inviteObj = { _id: new ObjectId(), discordId: targetUser.id, inviterId: interaction.user.id, message: `You are invited to join alliance ${alliance.name}`, createdAt: new Date(), expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)), status: 'pending' };
                await alliances.updateOne({ _id: alliance._id }, { $push: { invites: inviteObj } });

                const inviteEmbed = new EmbedBuilder()
                    .setTitle(`Alliance Invite: ${alliance.name}`)
                    .setDescription(inviteObj.message)
                    .addFields({ name: 'Invited By', value: `${interaction.user.username}` })
                    .setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00AE86)
                    .setTimestamp();

                const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const acceptId = `alliance_invite_accept:${alliance._id}:${inviteObj._id}`;
                const declineId = `alliance_invite_decline:${alliance._id}:${inviteObj._id}`;
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger)
                );

                if (target.confessionalId) {
                    const chan = await interaction.client.channels.fetch(target.confessionalId).catch(() => null);
                    if (chan) await chan.send({ embeds: [inviteEmbed], components: [row] }).catch(() => null);
                } else {
                    const userObj = await interaction.client.users.fetch(targetUser.id).catch(() => null);
                    if (userObj) await userObj.send({ embeds: [inviteEmbed], components: [row] }).catch(() => null);
                }

                await interaction.editReply({ content: `Invite sent to ${target.displayName || target.username || targetUser.tag}.`, ephemeral: true });
                return;
            }

            if (sub === 'leave') {
                // ensure member
                if (!Array.isArray(alliance.members) || !alliance.members.includes(interaction.user.id)) return await interaction.editReply({ content: 'You are not a member of this alliance.', ephemeral: true });

                await alliances.updateOne({ _id: alliance._id }, { $pull: { members: interaction.user.id } });
                try { const chan = await interaction.client.channels.fetch(channelId).catch(() => null); if (chan) await chan.permissionOverwrites.delete(interaction.user.id).catch(() => {}); } catch (e) { }

                // if no members remain, archive alliance and delete channel
                const updated = await alliances.findOne({ _id: alliance._id });
                if (!updated || !Array.isArray(updated.members) || updated.members.length === 0) {
                    await alliances.updateOne({ _id: alliance._id }, { $set: { active: false, closedAt: new Date() } });
                    try { const chan = await interaction.client.channels.fetch(channelId).catch(() => null); if (chan) await chan.delete().catch(() => {}); } catch (e) {}
                }

                await interaction.editReply({ content: 'You left the alliance.', ephemeral: true });
                return;
            }

        } catch (err) {
            console.error('alliancemember command error', err);
            try { await interaction.editReply({ content: 'There was an error running the command.', ephemeral: true }); } catch (e) {}
        }
    }
};
