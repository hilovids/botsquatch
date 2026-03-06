// Mini-race command: 8 random horses, allow betting, post results
const { SlashCommandBuilder } = require('discord.js');
const { getLatestRaceData } = require('../utils/mongodbUtil');
const { RaceSimulator } = require('../../umarble racing/simulator');
const { startGamble } = require('../utils/gambling');
const { EmbedBuilder } = require('discord.js');

function pickRandom(arr, n) {
  const shuffled = arr.slice().sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minimarble')
    .setDescription('Start a mini marble race with 8 random horses and allow betting.'),
  async execute(interaction) {
    await interaction.deferReply();
    const raceData = await getLatestRaceData();
    if (!raceData) return interaction.editReply('No race data found.');
    const racers = pickRandom(raceData.racers, 8);
    // Announce betting phase
    const betEmbed = new EmbedBuilder()
      .setTitle('Mini Marble Race Betting')
      .setDescription('Place your bets! Pick a marble to win:')
      .addFields(racers.map(r => ({ name: r.name, value: `Odds: ${r.odds || '?'}x`, inline: true })))
      .setColor('#00ff99');
    await interaction.followUp({ embeds: [betEmbed] });
    // Start betting session (reuse gambling logic, e.g. startGamble or similar)
    // For now, just wait 10s for demo
    await new Promise(res => setTimeout(res, 10000));
    // Run the mini race
    const simRacers = racers.map(r => ({
      name: r.name,
      color: r.color,
      stats: {
        Agility: r.Agility || Math.floor(Math.random()*7)+1,
        Brawn: r.Brawn || Math.floor(Math.random()*7)+1,
        Endurance: r.Endurance || Math.floor(Math.random()*7)+1,
        Mind: r.Mind || Math.floor(Math.random()*7)+1,
        Luck: r.Luck || Math.floor(Math.random()*7)+1,
        Resolve: r.Resolve || Math.floor(Math.random()*7)+1
      },
      skills: r.skills || { speedBurst: true },
      skillTiming: r.skillTiming || Math.random()
    }));
    const sim = new RaceSimulator(simRacers, {
      trackLength: raceData.courseLength,
      weather: raceData.weather,
      stages: 300,
      ticksPerStage: 10
    });
    const result = sim.run();
    // Post results
    const final = result.final;
    const summaryEmbed = new EmbedBuilder()
      .setTitle('Mini Marble Race Results')
      .setDescription(final.map((r, i) => `**${i+1}. ${r.name}** - ${r.total.toFixed(1)}m (${r.finishedAt !== Infinity ? `Finished at tick ${r.finishedAt}` : 'DNF'})`).join('\n'))
      .setColor('#FFD700');
    await interaction.followUp({ embeds: [summaryEmbed] });
    // TODO: Settle bets and pay out
  }
};
