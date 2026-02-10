const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { ensurePlaced, renderBoardImage } = require('../../utils/seachart');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seachart_view')
        .setDescription('Look at The Sea Chart (image)'),
    async execute(interaction) {
        await interaction.deferReply();
        const user = interaction.user;
        const db = await connectToMongo();
        const campersColl = db.collection('campers');
        const camper = await campersColl.findOne({ discordId: String(user.id) });
        if (!camper) {
            const exampleEmbed = new EmbedBuilder()
                .setColor(0x003280)
                .setTitle('Player Not Found')
                .setDescription('Your player profile was not found. Use /join to create one.')
                .setTimestamp();
            await interaction.editReply({ embeds: [exampleEmbed] });
            return;
        }

        // ensure placed
        const placed = await ensurePlaced(campersColl, camper);
        if (!camper.seachart_loc) camper.seachart_loc = placed;

        const campersList = await campersColl.find({}).toArray();
        const buffer = await renderBoardImage(camper, campersList);

        const viewEmbed = new EmbedBuilder()
            .setTitle('Lake Yazzy')
            .setDescription(`Your location: ${camper.seachart_loc || 'Unplaced'}`)
            .setColor(0x003280)
            .setImage('attachment://seachart.png')
            .addFields({ name: 'Legend', value: '🔳 You / Board star\n🟢 Dredged — Found\n⚪ Dredged — Nothing\nNumber: Items adjacent to this square\n⬛ Blocked cell' })
            .setTimestamp();

        await interaction.editReply({ embeds: [viewEmbed], files: [{ attachment: buffer, name: 'seachart.png' }] });
    }
};
