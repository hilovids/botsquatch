const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const { getBoard, ensurePlaced, isNewLocalDay, nextSeachartAvailable } = require('../../utils/seachart');

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

function adjacentPositions(pos){
  const col = pos[0].toUpperCase();
  const row = parseInt(pos.slice(1),10);
  const adj = [];
  for (let dc=-1; dc<=1; dc++){
    for (let dr=-1; dr<=1; dr++){
      if (dc===0 && dr===0) continue;
      const c = String.fromCharCode(col.charCodeAt(0) + dc);
      const r = row + dr;
      adj.push(`${c}${r}`);
    }
  }
  return adj;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seachart_scan')
    .setDescription('Take your scan action on The Sea Chart!')
    .addStringOption(option => option.setName('seachart_space').setDescription("The space to scan.").setRequired(true)),
  async execute(interaction) {
    const user = interaction.user;
    const target = interaction.options.getString('seachart_space');
    const db = await connectToMongo();
    const campersColl = db.collection('campers');
    const itemsColl = db.collection('seachart_items');

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
        .setTitle(`Invalid Space`)
        .setDescription(`Try formatting it like A1 or a1 within board bounds.`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

    const placedLoc = await ensurePlaced(campersColl, camper);
    if (!camper.seachart_loc) camper.seachart_loc = placedLoc;

    if (Math.max(Math.abs(target[0].toUpperCase().charCodeAt(0) - camper.seachart_loc[0].toUpperCase().charCodeAt(0)), Math.abs(parseInt(target.slice(1)) - parseInt(camper.seachart_loc.slice(1)))) > 1){
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`Your ship can't reach that spot.`)
        .setDescription(`You can only scan up to 1 space away.`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

    if (!isNewLocalDay(camper.lastDredged, camper.timezone || 'UTC')){
      const ts = nextSeachartAvailable(camper.lastDredged);
      const when = ts ? `<t:${ts}:R>` : 'soon';
      const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`You already used a command.`)
        .setDescription(`You can use another again ${when}`)
        .setTimestamp();
      await interaction.reply({ embeds: [exampleEmbed] });
      return;
    }

    // compute adjacent positions and count items (excluding curses possibly)
    const adj = adjacentPositions(target).map(s => s.toUpperCase()).filter(s => /^[A-O]\d{1,2}$/.test(s));
    const board = await getBoard();
    const adjFiltered = adj.filter(a => {
      const col = a[0].charCodeAt(0)-65; const row = parseInt(a.slice(1),10);
      return col>=0 && col < board.width && row>=0 && row < board.height;
    });

    const query = { position: { $in: adjFiltered } };
    const found = await itemsColl.find(query).toArray();
    let count = 0;
    found.forEach(doc => { if (doc.type && doc.type !== 'curse') count++; });
    // stars from board count
    const boardStars = (board.stars || []).map(s=>s.toUpperCase());
    adjFiltered.forEach(s => { if (boardStars.includes(s)) count++; });

    // save scan result and lastDredged as use of daily action
    const key = `seachart_scans.${target.toUpperCase()}`;
    await campersColl.updateOne({ discordId: String(user.id) }, { $set: { [key]: count, lastDredged: new Date() } });

    const numEmoji = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];
    const num = (count >=0 && count < numEmoji.length) ? numEmoji[count] : `${count}`;

    const text = `\u2B1C\u2B1C\u2B1C\n\u2B1C${num}\u2B1C\n\u2B1C\u2B1C\u2B1C\nThere are ${count} artifacts around the space ${target}.`;
    const exampleEmbed = new EmbedBuilder()
      .setColor(0x003280)
      .setTitle(`You scanned ${target}.`)
      .setDescription(text)
      .setTimestamp();
    await interaction.reply({ embeds: [exampleEmbed] });
  }
};
