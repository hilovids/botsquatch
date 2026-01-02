const { connectToMongo } = require('../utils/mongodbUtil');
const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        try {
            const db = await connectToMongo();
            const ceremonies = db.collection('ceremonies');
            const discordConfigs = db.collection('discordConfigs');

            // watch inserts and updates (lookup full document on updates)
            const stream = ceremonies.watch(
                [{ $match: { operationType: { $in: ['insert', 'update'] } } }],
                { fullDocument: 'updateLookup' }
            );

            stream.on('change', async change => {
                try {
                    // Only handle inserts or updates that actually modified the `votes` field
                    if (!change) return;
                    if (change.operationType === 'update') {
                        const ud = change.updateDescription || {};
                        const updatedFields = ud.updatedFields || {};
                        const removedFields = ud.removedFields || [];
                        const votesChanged = Object.keys(updatedFields).some(k => k === 'votes' || k.startsWith('votes.')) || removedFields.includes('votes');
                        if (!votesChanged) return; // skip updates that don't touch votes
                    }

                    const doc = change.fullDocument;
                    if (!doc) return;

                    // If your website writes votes differently, adjust this detection
                    const votes = doc.votes || [];
                    const lastVote = votes[votes.length - 1];
                    if (!lastVote) return;

                    const guildId = doc.guildId;
                    const discordConfig = await discordConfigs.findOne({ server_id: guildId });
                    const channelId = discordConfig && discordConfig.campground_id;
                    if (!channelId) return;

                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (!channel) return;

                    const title = "A vote has been cast!";
                    const desc = `${votes.length} vote(s) have been cast in the current ceremony...`;
                    const color = discordConfig && discordConfig.embed ? discordConfig.embed.color : 0x0099ff;
                    const thumbnail = discordConfig && discordConfig.embed ? discordConfig.embed.thumbnail_url : null;

                    const embed = new EmbedBuilder()
                        .setColor(color)
                        .setTitle(title)
                        .setDescription(desc)
                        .setThumbnail(thumbnail)

                    await channel.send({ embeds: [embed] });
                } catch (err) {
                    console.error('Error handling ceremony change:', err);
                }
            });

            console.log('MongoDB change stream for ceremonies started');
        } catch (err) {
            console.error('Failed to start MongoDB watch:', err);
        }
    }
};