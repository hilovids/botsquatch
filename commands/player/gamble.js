const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { startGamble } = require('../../utils/gambling');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Play a minigame gamble for stars or coins')
        .addStringOption(opt => opt.setName('game').setDescription('Which game to play').setRequired(true)
            .addChoices(
                { name: 'Card Shuffle', value: 'card' },
                { name: 'Blackjack', value: 'blackjack' },
                { name: 'Rock Paper Scissors', value: 'rps' }
            ))
        .addStringOption(opt => opt.setName('bet_type').setDescription('Bet with stars or coins').setRequired(true)
            .addChoices({ name: 'Stars', value: 'stars' }))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Bet amount').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });
        try {
            const game = interaction.options.getString('game');
            const betType = interaction.options.getString('bet_type');
            const amount = interaction.options.getInteger('amount');

            if (!['stars','coins'].includes(betType)) {
                await interaction.editReply({ content: 'Invalid bet type.', ephemeral: true });
                return;
            }

            if (!['card','blackjack','rps'].includes(game)) {
                await interaction.editReply({ content: 'Invalid game.', ephemeral: true });
                return;
            }

            if (!Number.isInteger(amount) || amount <= 0) {
                await interaction.editReply({ content: 'Bet amount must be a positive integer.', ephemeral: true });
                return;
            }

            await startGamble(interaction, game, betType, amount);
        } catch (err) {
            console.error('gamble command error', err);
            try { await interaction.editReply({ content: 'There was an error starting your gamble.', ephemeral: true }); } catch (e) {}
        }
    }
};
