const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('elimination')
        .setDescription('Eliminate a player, process egg tokens, assign spectator role, and increment week')
        .addStringOption(opt => opt.setName('target').setDescription('Target camper (username/displayName/discordId)').setRequired(true))
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const client = interaction.client;
        const targetText = interaction.options.getString('target');

        try {
            const db = await connectToMongo();
            const campersCol = db.collection('campers');
            const ceremoniesCol = db.collection('ceremonies');
            const discordConfigs = db.collection('discordConfigs');

            const discordConfig = await discordConfigs.findOne({ server_id: guildId });

            // find camper by exact or partial
            function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'); }
            const exactRegex = new RegExp('^' + escapeRegExp(targetText) + '$', 'i');
            let matches = await campersCol.find({ eliminated: { $ne: true }, $or: [ { displayName: exactRegex }, { username: exactRegex }, { discordId: targetText } ] }).toArray();
            let target = null;
            if (matches.length === 0) {
                const partial = await campersCol.find({ eliminated: { $ne: true }, $or: [ { displayName: new RegExp(escapeRegExp(targetText), 'i') }, { username: new RegExp(escapeRegExp(targetText), 'i') } ] }).toArray();
                if (partial.length === 1) target = partial[0];
                else if (partial.length > 1) {
                    await interaction.editReply({ content: `Multiple campers matched "${targetText}". Please be more specific.`, ephemeral: true });
                    return;
                }
            } else if (matches.length === 1) target = matches[0];
            else {
                await interaction.editReply({ content: `Multiple campers matched "${targetText}". Please be more specific.`, ephemeral: true });
                return;
            }

            if (!target) {
                await interaction.editReply({ content: `No camper matched "${targetText}".`, ephemeral: true });
                return;
            }

            // mark eliminated in DB
            await campersCol.updateOne({ _id: target._id }, { $set: { eliminated: true, eliminatedAt: new Date() } });

            // role changes: remove camper role, add spectator role
            try {
                const camperRoleId = discordConfig && (discordConfig.camper_role_id || discordConfig.camper_role);
                const spectatorRoleId = discordConfig && (discordConfig.spectator_role_id || discordConfig.spectator_role);
                const member = await interaction.guild.members.fetch(String(target.discordId)).catch(() => null);
                if (member) {
                    if (camperRoleId) await member.roles.remove(camperRoleId).catch(() => {});
                    if (spectatorRoleId) await member.roles.add(spectatorRoleId).catch(() => {});
                }
            } catch (e) { console.error('error updating roles for eliminated player', e); }

            // increment week in discordConfig
            let newWeek = null;
            try {
                const currentWeek = (discordConfig && typeof discordConfig.current_week === 'number') ? discordConfig.current_week : 0;
                newWeek = currentWeek + 1;
                await discordConfigs.updateOne({ _id: discordConfig._id }, { $set: { current_week: newWeek } });
            } catch (e) { console.error('error incrementing week', e); }

            // clear curses for all players for the upcoming week
            try {
                await campersCol.updateMany({}, { $set: { 'curses.noVote': false, 'curses.silent': false, 'curses.confused': false } });
            } catch (e) { console.error('error clearing curses for new week', e); }

            // process egg tokens from the most recent ceremony that has tokens
            try {
                const ceremony = await ceremoniesCol.findOne({ guildId }, { sort: { createdAt: -1 } });
                const ceremonyTokens = ceremony && Array.isArray(ceremony.tokens) ? ceremony.tokens : [];
                const awarded = [];
                for (const t of ceremonyTokens.filter(x => x && x.type === 'egg')) {
                    try {
                        // compare targetId to eliminated player's _id
                        if (!t.targetId) continue;
                        if (String(t.targetId) !== String(target._id)) continue;

                        // award immunity to owner
                        const owner = await campersCol.findOne({ discordId: t.userId });
                        if (owner) {
                            await campersCol.updateOne({ _id: owner._id }, { $inc: { 'inventory.immunityTokens': 1 } });
                            // notify owner in their confessional
                            try {
                                const confId = owner.confessionalId;
                                if (confId) {
                                    const chan = await client.channels.fetch(confId).catch(() => null);
                                    if (chan) {
                                        const embed = new EmbedBuilder()
                                            .setTitle('You have been awarded an Immunity Token!')
                                            .setDescription('Your egg token resulted in an elimination, and hatched into an Immunity Token!')
                                            .setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00FF00)
                                            .setImage('attachment://immunity_token.png');

                                        const imgPath = path.join(__dirname, '../../assets/immunity_token.png');
                                        await chan.send({ embeds: [embed], files: [{ attachment: imgPath, name: 'immunity_token.png' }] }).catch(() => {});
                                    }
                                }
                            } catch (e) { console.error('error notifying egg owner', e); }
                            awarded.push({ owner: t.userId });
                        }
                    } catch (e) { console.error('error processing egg token', e); }
                }
            } catch (e) { console.error('error processing ceremony egg tokens', e); }

            // delete seance channels (cleanup)
            let seancesDeleted = 0;
            try {
                const seanceCat = discordConfig && (discordConfig.seance_category_id || discordConfig.seance_category);
                if (seanceCat) {
                    const guild = interaction.guild;
                    const allChannels = await guild.channels.fetch();
                    const toDelete = allChannels.filter(ch => ch.parentId === seanceCat);
                    for (const ch of toDelete.values()) {
                        try { await ch.delete().catch(() => {}); seancesDeleted++; } catch (e) { }
                    }
                }
            } catch (e) { console.error('error deleting seance channels', e); }

            // reply with summary to admin
            let reply = `Eliminated ${target.displayName || target.username || target.discordId}.`;
            if (newWeek !== null) reply += ` Week incremented to ${newWeek}.`;
            await interaction.editReply({ content: reply, ephemeral: true });

        } catch (err) {
            console.error('elimination command error', err);
            try { await interaction.editReply({ content: 'There was an error processing the elimination.', ephemeral: true }); } catch (e) {}
        }
    }
};
