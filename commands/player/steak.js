const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('steak')
        .setDescription('Steak related fun commands')
        .addSubcommand(sub => sub.setName('yummy').setDescription('Say the steak is yummy')),
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'yummy') {
            await interaction.reply('Yummy! 🥩');
            return;
        }

        await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    }
};
