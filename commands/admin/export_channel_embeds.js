const { SlashCommandBuilder, ChannelType } = require('discord.js');
const JSZip = require('jszip');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('export_channel_embeds')
        .setDescription('Export all embeds from a channel as JSON files packed in a zip')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to pull embeds from')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Max number of messages to scan (default 100, max 500)')
                .setMinValue(1)
                .setMaxValue(500)
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const channel = interaction.options.getChannel('channel');
        const limit = interaction.options.getInteger('limit') ?? 100;

        if (!channel.isTextBased()) {
            await interaction.editReply({ content: 'That channel does not support messages.' });
            return;
        }

        try {
            // Paginate — Discord caps a single fetch at 100
            const allMessages = new Map();
            let lastId = null;

            while (allMessages.size < limit) {
                const batchSize = Math.min(limit - allMessages.size, 100);
                const fetchOptions = { limit: batchSize };
                if (lastId) fetchOptions.before = lastId;

                const batch = await channel.messages.fetch(fetchOptions);
                if (batch.size === 0) break;

                for (const [id, msg] of batch) {
                    allMessages.set(id, msg);
                }

                lastId = batch.last()?.id;
                if (batch.size < batchSize) break; // no more messages in channel
            }

            // Build zip — one JSON file per embed
            const zip = new JSZip();
            let embedCount = 0;

            for (const [messageId, message] of allMessages) {
                if (!message.embeds || message.embeds.length === 0) continue;

                for (let i = 0; i < message.embeds.length; i++) {
                    const record = {
                        messageId,
                        channelId: channel.id,
                        channelName: channel.name,
                        timestamp: message.createdAt.toISOString(),
                        authorId: message.author?.id ?? null,
                        authorTag: message.author?.tag ?? 'Unknown',
                        embed: message.embeds[i].toJSON(),
                    };

                    zip.file(`embed_${messageId}_${i + 1}.json`, JSON.stringify(record, null, 2));
                    embedCount++;
                }
            }

            if (embedCount === 0) {
                await interaction.editReply({
                    content: `No embeds found in <#${channel.id}> within the last ${allMessages.size} messages.`,
                });
                return;
            }

            const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
            const zipName = `embeds_${channel.name}_${Date.now()}.zip`;

            // Try DM first; fall back to attaching directly to the ephemeral reply
            try {
                await interaction.user.send({
                    content: `Found **${embedCount}** embed(s) across **${allMessages.size}** messages in <#${channel.id}>:`,
                    files: [{ attachment: zipBuffer, name: zipName }],
                });
                await interaction.editReply({
                    content: `Done! Sent **${embedCount}** embed(s) from <#${channel.id}> as \`${zipName}\` via DM.`,
                });
            } catch {
                await interaction.editReply({
                    content: `Found **${embedCount}** embed(s) from <#${channel.id}>:`,
                    files: [{ attachment: zipBuffer, name: zipName }],
                });
            }
        } catch (err) {
            console.error('[export_channel_embeds] Error:', err);
            await interaction.editReply({ content: `Error: ${err.message}` });
        }
    },
};
