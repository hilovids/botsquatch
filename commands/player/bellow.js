const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bellow')
    .setDescription('Reply with the gecko image'),

  async execute(interaction) {
    const imgPath = path.join(__dirname, '../../assets/gecko.png');
    const attachment = new AttachmentBuilder(imgPath);
    await interaction.reply({ files: [attachment] });
  }
};
