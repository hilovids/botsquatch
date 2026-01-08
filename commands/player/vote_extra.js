const { SlashCommandBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const Jimp = require('jimp');
const path = require('path');

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote_extra')
        .setDescription('Spend an extra vote to cast an additional elimination vote')
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
        const targetText = interaction.options.getString('target');
        const attachment = interaction.options.getAttachment('image');

        try {
            const db = await connectToMongo();
            const ceremonies = db.collection('ceremonies');
            const campersCol = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');

            const ceremony = await ceremonies.findOne({ guildId, active: true });
            const discordConfig = await discordConfigs.findOne({ server_id: guildId });
            if (!ceremony) {
                const e = new (require('discord.js')).EmbedBuilder().setTitle('No Ceremony').setDescription('No active elimination ceremony to vote in.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            // find the voter camper record to check extra votes
            const voter = await campersCol.findOne({ discordId: interaction.user.id });
            if (!voter) {
                const e = new (require('discord.js')).EmbedBuilder().setTitle('No Profile').setDescription('Could not find your player record. You cannot use an extra vote.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }
            if (voter.eliminated) {
                const e = new (require('discord.js')).EmbedBuilder().setTitle('Eliminated').setDescription('Eliminated players cannot vote.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }
            // prevent cursed players with noVote from using extra votes
            if (voter.curses && voter.curses.noVote) {
                const e = new (require('discord.js')).EmbedBuilder().setTitle('Cursed').setDescription('You are cursed and cannot vote.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            const available = (voter.inventory && voter.inventory.voteTokens) ? (voter.inventory.voteTokens) : 0;
            if (available <= 0) {
                await interaction.editReply({ content: 'You do not have any extra votes to spend.', ephemeral: true });
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
                    const em = new (require('discord.js')).EmbedBuilder().setTitle('Multiple Matches').setDescription(`Multiple campers matched "${targetText}". Please be more specific.`).setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                    await interaction.editReply({ embeds: [em], ephemeral: true });
                    return;
                }
            } else if (matches.length === 1) camper = matches[0];
            else {
                await interaction.editReply({ content: `Multiple campers matched "${targetText}". Please be more specific.`, ephemeral: true });
                return;
            }

            if (!camper) {
                const em = new (require('discord.js')).EmbedBuilder().setTitle('No Match').setDescription(`No camper matched "${targetText}".`).setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [em], ephemeral: true });
                return;
            }

            // ensure target is allowed by ceremony team
            if (ceremony.team && ceremony.team !== 'all' && camper.team !== ceremony.team) {
                const em = new (require('discord.js')).EmbedBuilder().setTitle('Not Eligible').setDescription(`That camper is not eligible in this vote.`).setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
                await interaction.editReply({ embeds: [em], ephemeral: true });
                return;
            }

            // prepare vote object (same structure as normal votes)
            const vote = {
                voterId: interaction.user.id,
                voterName: interaction.user.tag,
                targetId: camper._id,
                targetName: camper.displayName || camper.username || camper.discordId,
                createdAt: new Date(),
                extra: true,
                image: {
                    contentType: null,
                    data: null,
                    size: null,
                    filename: null
                }
            };

            if (attachment) {
                vote.image.contentType = attachment.contentType;
                vote.image.size = attachment.size;
                vote.image.filename = attachment.name;
                const response = await fetch(attachment.url);
                const buffer = await response.buffer();
                const image = await Jimp.read(buffer);
                const mime = image.getMIME();
                const processedBuffer = await image.getBufferAsync(mime);
                vote.image.contentType = mime;
                vote.image.data = processedBuffer;
            } else {
                // create default vote image like the normal vote command
                try {
                    const bgPath = path.join(__dirname, '..', '..', 'assets', 'vote_board.png');
                    const image = await Jimp.read(bgPath);
                    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
                    const text = vote.targetName || targetText;

                    const w = image.bitmap.width;
                    const h = image.bitmap.height;

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
                    const safeName = (text || 'vote').replace(/[^a-z0-9-_\.]/gi, '_');
                    vote.image.filename = `${safeName}.png`;
                } catch (imgErr) {
                    console.error('error creating default vote image', imgErr);
                }
            }

            // push the vote into the ceremony document
            await ceremonies.updateOne({ _id: ceremony._id }, { $push: { votes: vote } });

            // decrement the voter's extra vote token
            await campersCol.updateOne({ _id: voter._id }, { $inc: { 'inventory.voteTokens': -1 } });

            // fetch updated voter to report remaining tokens
            const updatedVoter = await campersCol.findOne({ _id: voter._id });
            const remaining = (updatedVoter.inventory && updatedVoter.inventory.voteTokens) ? updatedVoter.inventory.voteTokens : 0;

            const ok = new (require('discord.js')).EmbedBuilder().setTitle('Extra Vote Recorded').setDescription(`Your extra vote for **${vote.targetName}** has been recorded. You have ${remaining} extra vote(s) remaining.`).setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff);
            await interaction.editReply({ embeds: [ok], ephemeral: true });

        } catch (err) {
            console.error('vote_extra command error', err);
            const em = new (require('discord.js')).EmbedBuilder().setTitle('Error').setDescription('There was an error recording your extra vote.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
            await interaction.editReply({ embeds: [em], ephemeral: true });
        }
    },
};
