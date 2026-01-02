const { SlashCommandBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const Jimp = require('jimp');
const path = require('path');

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Cast an elimination vote')
        .addStringOption(option =>
            option.setName('target')
                .setDescription("Discord username of the Camper you're voting for")
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Optional image to attach to your vote')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const client = interaction.client;
        const targetText = interaction.options.getString('target');
        const attachment = interaction.options.getAttachment('image');

        try {
            const db = await connectToMongo();
            const ceremonies = db.collection('ceremonies');
            const campersCol = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');

            const discordConfig = await discordConfigs.findOne({ server_id: guildId });

            const ceremony = await ceremonies.findOne({ guildId, active: true });
            if (!ceremony) {
                await interaction.editReply({ content: 'No active elimination ceremony to vote in.', ephemeral: true });
                return;
            }

            // prevent duplicate votes for the same user in this ceremony
            if (ceremony.votes && ceremony.votes.some(v => v.voterId === interaction.user.id)) {
                await interaction.editReply({ content: 'You have already voted in this ceremony. If you are using an extra vote, please use /extra_vote instead.', ephemeral: true });
                return;
            }

            const voter = await campersCol.findOne({ discordId: interaction.user.id });
            if (!voter) {
                await interaction.editReply({ content: 'Could not find your player record. You cannot vote.', ephemeral: true });
                return;
            }
            // prevent cursed players with noVote from voting
            if (voter.curses && voter.curses.noVote) {
                await interaction.editReply({ content: 'You are cursed and cannot vote.', ephemeral: true });
                return;
            }

            // find matching campers (not eliminated)
            const exactRegex = new RegExp('^' + escapeRegExp(targetText) + '$', 'i');
            const matches = await campersCol.find({
                eliminated: { $ne: true },
                $or: [
                    { displayName: exactRegex },
                    { username: exactRegex },
                    { discordId: targetText }
                ]
            }).toArray();

            let camper = null;
            if (matches.length === 0) {
                // try partial match
                const partialRegex = new RegExp(escapeRegExp(targetText), 'i');
                const partial = await campersCol.find({
                    eliminated: { $ne: true },
                    $or: [
                        { displayName: partialRegex },
                        { username: partialRegex }
                    ]
                }).toArray();
                if (partial.length === 1) camper = partial[0];
                else if (partial.length > 1) {
                    await interaction.editReply({ content: `Multiple campers matched "${targetText}". Please be more specific.`, ephemeral: true });
                    return;
                }
            } else if (matches.length === 1) camper = matches[0];
            else {
                await interaction.editReply({ content: `Multiple campers matched "${targetText}". Please be more specific.`, ephemeral: true });
                return;
            }

            if (!camper) {
                await interaction.editReply({ content: `No camper matched "${targetText}".`, ephemeral: true });
                return;
            }

            // ensure target is allowed by ceremony team
            if (ceremony.team && ceremony.team !== 'all' && camper.team !== ceremony.team) {
                await interaction.editReply({ content: `That camper is not eligible in this vote.`, ephemeral: true });
                return;
            }

            // prepare vote object
            const vote = {
                voterId: interaction.user.id,
                voterName: interaction.user.tag,
                targetId: camper._id,
                targetName: camper.displayName || camper.username || camper.discordId,
                createdAt: new Date(),
                image: {
                    contentType: null,
                    data: null,
                    size: null,
                    filename: null
                }
            };

            if(attachment) {
                vote.image.contentType = attachment.contentType;
                vote.image.size = attachment.size;
                vote.image.filename = attachment.name;
                const response = await fetch(attachment.url);
                const buffer = await response.buffer();
                // process image with Jimp to standardize format
                const image = await Jimp.read(buffer);
                const mime = image.getMIME();
                const processedBuffer = await image.getBufferAsync(mime);
                vote.image.contentType = mime;
                vote.image.data = processedBuffer;
            } else {
                // No attachment provided — create a default vote image
                try {
                    const bgPath = path.join(__dirname, '..', '..', 'assets', 'vote_board.png');
                    const image = await Jimp.read(bgPath);

                    // choose a white sans font; size 64 should be reasonable for most boards
                    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
                    const text = vote.targetName || targetText;

                    const w = image.bitmap.width;
                    const h = image.bitmap.height;

                    // measure text and position it at ~60% height, centered
                    const textWidth = Jimp.measureText(font, text);
                    const textHeight = Jimp.measureTextHeight(font, text, w);
                    const x = Math.max(0, Math.floor((w - textWidth) / 2));
                    const y = Math.max(0, Math.floor((h * 0.4) - textHeight / 2));

                    image.print(font, x, y, {
                        text: text,
                        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
                        alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
                    }, textWidth, textHeight);

                    const mime = Jimp.MIME_PNG;
                    const processedBuffer = await image.getBufferAsync(mime);

                    vote.image.contentType = mime;
                    vote.image.data = processedBuffer;
                    vote.image.size = processedBuffer.length;
                    // sanitize filename
                    const safeName = (text || 'vote').replace(/[^a-z0-9-_\.]/gi, '_');
                    vote.image.filename = `${safeName}.png`;
                } catch (imgErr) {
                    console.error('error creating default vote image', imgErr);
                }
            }
            
            // push the vote into the ceremony document
            await ceremonies.updateOne({ _id: ceremony._id }, { $push: { votes: vote } });

            await interaction.editReply({ content: `Your vote for **${vote.targetName}** has been recorded.`, ephemeral: true });

        } catch (err) {
            console.error('vote command error', err);
            await interaction.editReply({ content: 'There was an error recording your vote.', ephemeral: true });
        }
    },
};