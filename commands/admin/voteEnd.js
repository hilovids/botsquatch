const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const JSZip = require('jszip');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote_end')
        .setDescription('End the active elimination vote, download vote images, and post a summary')
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const client = interaction.client;

        try {
            const db = await connectToMongo();
            const ceremonies = db.collection('ceremonies');
            const discordConfigs = db.collection('discordConfigs');

            const discordConfig = await discordConfigs.findOne({ server_id: guildId });

            const ceremony = await ceremonies.findOne({ guildId, active: true });
            if (!ceremony) {
                await interaction.editReply({ content: 'No active ceremony to end.', ephemeral: true });
                return;
            }

            const votes = Array.isArray(ceremony.votes) ? ceremony.votes : [];
            const votesCount = votes.length;
            const tokensUsed = ceremony.tokens.length;

            // analyze ceremony tokens for summary (do not process egg awards here)
            const ceremonyTokens = Array.isArray(ceremony.tokens) ? ceremony.tokens : [];
            const tokenCounts = {};
            for (const t of ceremonyTokens) {
                if (!t || !t.type) continue;
                tokenCounts[t.type] = (tokenCounts[t.type] || 0) + 1;
            }

            // prepare zip of vote images (moved from voteDownload)
            const zip = new JSZip();
            let added = 0;

            for (let i = 0; i < votes.length; i++) {
                const v = votes[i];
                if (!v || !v.image || !v.image.data) continue;
                let buf = null;
                try {
                    if (Buffer.isBuffer(v.image.data)) buf = v.image.data;
                    else if (v.image.data.buffer) buf = Buffer.from(v.image.data.buffer);
                    else buf = Buffer.from(v.image.data);
                } catch (e) {
                    continue;
                }

                const filename = `vote_${i + 1}.png`;
                let name = filename;
                let k = 1;
                while (zip.file(name)) {
                    const dot = filename.lastIndexOf('.');
                    if (dot > 0) name = filename.slice(0, dot) + `_${k}` + filename.slice(dot);
                    else name = `${filename}_${k}`;
                    k++;
                }

                zip.file(name, buf);
                added++;
            }

            let zipSent = false;
            let zipNote = '';
            if (added > 0) {
                const content = await zip.generateAsync({ type: 'nodebuffer' });
                try {
                    await interaction.user.send({ files: [{ attachment: content, name: `votes_${ceremony._id}.zip` }] });
                    zipSent = true;
                    zipNote = `Sent ${added} images as votes_${ceremony._id}.zip via DM.`;
                } catch (dmErr) {
                    console.error('DM failed for vote_end, falling back to channel:', dmErr);
                    zipNote = `Could not DM you; ${added} images will be attached in the follow-up.`;
                }
            } else {
                zipNote = 'No vote images were found for the active ceremony.';
            }

            // set ceremony inactive and record endedAt and summary
            await ceremonies.updateOne({ _id: ceremony._id }, { $set: { active: false, endedAt: new Date(), summary: { votesCount, tokensUsed } } });

            // prepare embed summary
            function parseColor(c) {
                if (!c) return 0xFEB316;
                if (typeof c === 'number') return c;
                if (typeof c === 'string') {
                    let s = c.trim();
                    if (s.startsWith('#')) s = s.slice(1);
                    if (s.startsWith('0x')) s = s.slice(2);
                    const num = parseInt(s, 16);
                    if (!isNaN(num)) return num;
                    const asNum = parseInt(s, 10);
                    if (!isNaN(asNum)) return asNum;
                }
                return 0xFEB316;
            }

            const color = parseColor(discordConfig && discordConfig.embed && discordConfig.embed.color);
            const thumbnail = (discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url) ? discordConfig.embed.thumbnail_url : '';

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle('All Votes Are In!')
                .setDescription(`Voting has ended. ${votesCount} vote(s) were cast. ${tokensUsed} token(s) were used.`)
                .setThumbnail(thumbnail);

            // send embed to campground channel if available
            let sentToCampground = false;
            if (discordConfig && discordConfig.campground_id) {
                try {
                    const campground = await client.channels.fetch(discordConfig.campground_id);
                    if (campground) {
                        if (added > 0 && !zipSent) {
                            // if we couldn't DM, attach zip to the campground message
                            const content = await zip.generateAsync({ type: 'nodebuffer' });
                            await campground.send({ embeds: [embed], files: [{ attachment: content, name: `votes_${ceremony._id}.zip` }] });
                        } else {
                            await campground.send({ embeds: [embed] });
                        }
                        sentToCampground = true;
                    }
                } catch (e) {
                    console.error('Error sending embed to campground', e);
                }
            }

            // Build detailed summary for admin embed
            try {
                const campersCol = db.collection('campers');

                // immunity holders from ceremony.tokens
                const immunityTokens = ceremonyTokens.filter(t => t.type === 'immunity');
                const immunityUserIds = immunityTokens.map(t => t.userId).filter(Boolean);
                const usersToLookup = Array.from(new Set([...immunityUserIds, ...ceremonyTokens.map(t => t.userId).filter(Boolean)]));

                // gather target ids from votes
                const targetIds = Array.from(new Set(votes.map(v => v.targetId).filter(Boolean).map(id => String(id))));

                // lookup campers for names
                const { ObjectId } = require('mongodb');
                const idQueries = targetIds.map(id => {
                    try { return ObjectId(id); } catch (e) { return id; }
                });
                const userCamperDocs = await campersCol.find({ $or: [ { discordId: { $in: usersToLookup } }, { _id: { $in: idQueries } } ] }).toArray();
                const byDiscord = {};
                const byId = {};
                for (const c of userCamperDocs) {
                    if (c.discordId) byDiscord[String(c.discordId)] = c;
                    if (c._id) byId[String(c._id)] = c;
                }

                // token usage listing
                const tokenUsageLines = ceremonyTokens.map(t => {
                    const user = t.userId ? (byDiscord[String(t.userId)] ? (byDiscord[String(t.userId)].displayName || byDiscord[String(t.userId)].username) : String(t.userId)) : 'unknown';
                    // if (t.type === 'egg') {
                    //     const tid = t.targetId ? String(t.targetId) : 'unknown';
                    //     const tgt = byId[tid] ? (byId[tid].displayName || byId[tid].username) : tid;
                    //     return `${t.type}: ${user} -> ${tgt}`;
                    // }
                    return `${t.type}: ${user}`;
                });

                // extra votes count
                const extraVotesCount = votes.filter(v => v && v.extra).length;

                // compute who would be eliminated excluding immunity holders
                const immuneSet = new Set(immunityUserIds.map(String));
                const tally = {};
                for (const v of votes) {
                    const tid = v.targetId ? String(v.targetId) : null;
                    if (!tid) continue;
                    // skip if target is immune
                    const targetCamper = byId[tid];
                    const targetDiscordId = targetCamper ? String(targetCamper.discordId) : null;
                    if (targetDiscordId && immuneSet.has(targetDiscordId)) continue;
                    tally[tid] = (tally[tid] || 0) + 1;
                }
                let wouldBeEliminated = [];
                let maxVotes = 0;
                for (const [tid, cnt] of Object.entries(tally)) {
                    if (cnt > maxVotes) { maxVotes = cnt; wouldBeEliminated = [tid]; }
                    else if (cnt === maxVotes) wouldBeEliminated.push(tid);
                }

                const eliminatedNames = wouldBeEliminated.map(tid => byId[tid] ? (byId[tid].displayName || byId[tid].username) : tid);

                const immuneNames = immunityUserIds.map(id => byDiscord[id] ? (byDiscord[id].displayName || byDiscord[id].username) : id);

                const adminEmbed = new EmbedBuilder()
                    .setTitle('Vote Summary')
                    .setColor(color)
                    .setDescription(`Voting has ended for Week ${discordConfig ? discordConfig.current_week : 'N/A'}.`)
                    .addFields(
                        { name: 'Total Votes', value: String(votesCount), inline: true },
                        { name: 'Extra Votes Cast', value: String(extraVotesCount), inline: true },
                        { name: 'Tokens Used', value: String(ceremonyTokens.length), inline: true },
                        { name: 'Immunity Holders', value: immuneNames.length ? immuneNames.join(', ') : 'None' },
                        { name: 'Token Usage', value: tokenUsageLines.length ? tokenUsageLines.join('\n') : 'None' },
                        { name: 'Would Be Eliminated', value: eliminatedNames.length ? eliminatedNames.join(', ') : 'No eligible targets or all immune' }
                    )
                    .setThumbnail(thumbnail);

                // send embed to the channel the admin used the command in
                try {
                    await interaction.channel.send({ embeds: [adminEmbed] });
                } catch (e) { console.error('error sending admin summary embed', e); }

                // also set reply text ephemeral to confirm
                await interaction.editReply({ content: 'Vote summary posted to this channel.', ephemeral: true });
            } catch (e) {
                console.error('error building admin summary', e);
                await interaction.editReply({ content: 'Vote ended. Summary could not be prepared.', ephemeral: true });
            }

            // if DM failed and we have zip content and we didn't attach to campground, follow up publicly with the zip
            if (added > 0 && !zipSent && !(discordConfig && discordConfig.campground_id && sentToCampground)) {
                const content = await zip.generateAsync({ type: 'nodebuffer' });
                await interaction.followUp({ files: [{ attachment: content, name: `votes_${ceremony._id}.zip` }], ephemeral: false });
            }

        } catch (err) {
            console.error('vote_end error', err);
            try { await interaction.editReply({ content: 'There was an error ending the vote.', ephemeral: true }); } catch (e) {}
        }
    }
};
