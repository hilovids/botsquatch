const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { mySql } = require('../../config.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('goldstar')
		.setDescription('Assign a gold star to a camper!')
        .addUserOption(option => option.setName('user').setDescription("The camper getting the gold star."))
        .setDefaultMemberPermissions(0),
	async execute(interaction) {
        const user = interaction.options.getUser("user");
        const exampleEmbed = new EmbedBuilder()
        .setColor(0xFEB316)
        .setTitle(`${user.username} gets a Gold Star!`)
        .setURL('https://hilovids.github.io/camp-hilo/index.html')
        .setDescription('Wow! Congrats! You now have... a number of them.')
        .setThumbnail('https://imgur.com/mfc6IFp.png')
        .setTimestamp()
        await interaction.channel.send({ embeds: [exampleEmbed] });
    },
};