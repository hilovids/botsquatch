const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('big')
		.setDescription('Replies with foot!'),
	async execute(interaction) {
		await interaction.reply('Foot!');
	},
};