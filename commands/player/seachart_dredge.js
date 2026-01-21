const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { getBoard, ensurePlaced, isNewLocalDay, handleFindItem, canReach } = require('../../utils/seachart');

async function isValidGridSpace15(str){
  if(!str) return false;
  const match = str.toUpperCase().match(/^([A-O])(\d{1,2})$/);
  if(!match) return false;
  const col = match[1].charCodeAt(0) - 65;
  const row = parseInt(match[2],10);
  const board = await getBoard();
  if (!(col >=0 && col < board.width && row >=0 && row < board.height)) return false;
  const pos = `${match[1]}${match[2]}`.toUpperCase();
  const blocked = (board.blocked || []).map(s => s.toUpperCase());
  if (blocked.includes(pos)) return false;
  return true;
}

function distanceBetween(sp1, sp2){
  const c1 = sp1[0].toUpperCase();
  const c2 = sp2[0].toUpperCase();
  const r1 = parseInt(sp1.slice(1),10);
  const r2 = parseInt(sp2.slice(1),10);
  const dc = Math.abs(c1.charCodeAt(0) - c2.charCodeAt(0));
  const dr = Math.abs(r1 - r2);
  return Math.max(dc, dr);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seachart_dredge')
    .setDescription('Take your dredge action on The Sea Chart!')
    .addStringOption(option => option.setName('seachart_space').setDescription("The space to dredge.").setRequired(true)),
  async execute(interaction) {
    const user = interaction.user;
    const target = interaction.options.getString('seachart_space');
    const db = await connectToMongo();
    const campersColl = db.collection('campers');

    const camper = await campersColl.findOne({ discordId: String(user.id) });
    if (!camper) {
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`You aren't in the system! `)
        .setDescription(`This is only for campers at the moment :3`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

    // require confessional channel if configured
    if (camper.confessionalId) {
      const chanId = String(interaction.channelId || interaction.channel.id || '');
      if (chanId !== String(camper.confessionalId)) {
        const exampleEmbed = new EmbedBuilder()
          .setColor(0x003280)
          .setTitle(`Use your confessional channel`)
          .setDescription(`This command can only be used in your confessional channel: <#${camper.confessionalId}>`)
          .setTimestamp();
        await interaction.reply({ embeds: [exampleEmbed], ephemeral: true });
        return;
      }
    }

    if (!(await isValidGridSpace15(target))){
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`Invalid Space Format`)
        .setDescription(`Try formatting it like A1 or a1 within board bounds.`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

    const placedLoc = await ensurePlaced(campersColl, camper);
    if (!camper.seachart_loc) camper.seachart_loc = placedLoc;

    if (distanceBetween(camper.seachart_loc, target) > 1){
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`Your ship can't reach that spot.`)
        .setDescription(`You can only dredge up to 1 space away.`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

      // check path with diagonal corner rules
      const reach = await canReach(camper.seachart_loc, target, 1);
      if (!reach.ok) {
        const exampleEmbed = new EmbedBuilder()
          .setColor(0x003280)
          .setTitle(`Cannot reach ${target}`)
          .setDescription(reach.reason === 'corner_block' ? `Diagonal walls block access to that square — try moving to clear one of the adjacent orthogonal spaces.` : `There's no clear path to that square.`)
          .setTimestamp();
        await interaction.reply({ embeds: [exampleEmbed] });
        return;
      }

    if (!isNewLocalDay(camper.lastDredged, camper.timezone || 'UTC')){
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`You already used this command today.`)
        .setDescription(`Try again tomorrow according to your timezone.`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

    // perform find
    const result = await handleFindItem(db, camper, target);

    // update lastDredged for daily action
    const dredgeKey = `seachart_dredged.${target.toUpperCase()}`;
    const dredgeVal = (result.type === 'nothing') ? 'nothing' : 'found';
    await campersColl.updateOne({ discordId: String(user.id) }, { $set: { lastDredged: new Date(), [dredgeKey]: dredgeVal } });

    const exampleEmbed = new EmbedBuilder()
      .setColor(0x003280)
      .setTitle(`You dredged ${target}.`)
      .setDescription(result.text)
      .setTimestamp();

    if (result.image) {
      const filename = result.filename || 'found.png';
      exampleEmbed.setImage(`attachment://${filename}`);
      await interaction.reply({ embeds: [exampleEmbed], files: [{ attachment: result.image, name: filename }] });
    } else {
      await interaction.reply({ embeds: [exampleEmbed] });
    }
  }
};
