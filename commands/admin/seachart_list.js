const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seachart_list')
    .setDescription('Shows where everyone is on The Sea Chart')
    .setDefaultMemberPermissions(0),
  async execute(interaction) {
    const user = interaction.user;
    const db = await connectToMongo();
    const campersColl = db.collection('campers');
    const camper = await campersColl.findOne({ discordId: String(user.id) });
    if (!camper) {
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`You aren't in the system! `)
        .setDescription(`Wave hello using /hello command.`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

    const all = await campersColl.find({ seachart_loc: { $exists: true } }).toArray();
    let text = '';
    all.forEach(el => {
      const name = el.displayName || el.preferred_name || el.username || el.assetName || 'Camper';
      text += `${name} - ${el.seachart_loc || 'Unplaced'}\n`;
    });

    const exampleEmbed = new EmbedBuilder()
      .setColor(0x003280)
      .setTitle(`The Sea Chart`) 
      .setDescription(text || 'No campers placed yet')
      .setTimestamp();
    await interaction.reply({ embeds: [exampleEmbed] });
  }
};
