const { getRankedData } = require("../utility/leagueUtility.js");
const { league_channelId } = require('../config.json');
const { Events, Client, EmbedBuilder } = require('discord.js');

let formattedString = "";

async function PostEmbed(data, client){
	console.log("Running embed function...");
	var tempString = `Brooks is currently ${data.tier} ${data.rank}, ${data.leaguePoints}LP\n${data.wins}W - ${data.losses}L`
	if(formattedString != tempString){
		formattedString = tempString;
		let color = 0xDBB02A;
		let thumb = "";
		switch(data.tier) {
			case "IRON":
			  color = 0x8B7762;
			  thumb = "https://imgur.com/TqvtOjA.png";
			  break;
			case "BRONZE":
				color = 0xA56522;
				thumb = "https://imgur.com/XPRdSxb.png";
				break;
			case "SILVER":
				color = 0xBDBDBD;
				thumb = "https://imgur.com/E7O80Ez.png";
				break;
			case "GOLD":
				color = 0xDBB02A;
				thumb = "https://imgur.com/JpmlKz0.png";
				break;
			case "PLATINUM":
				color = 0x87C9AF;
				thumb = "https://imgur.com/Q72vlEy.png";
				break;
			case "EMERALD":
				color = 0x34D695;
				thumb = "https://imgur.com/9pr7Nxu.png";
				break;
			default:
				color = 0xDBB02A;
				thumb = "";
				break;
		  }

		const embed = new EmbedBuilder()
		.setColor(color)
		.setTitle("Brooks played league today!")
		.setDescription(formattedString)
		.setThumbnail(thumb)
		.setTimestamp()

		const channelId = league_channelId;
		const channel = client.channels.cache.get(channelId);

		if(channel){
			channel.send({ embeds: [embed] })
            .then(() => console.log('Embed sent successfully!'))
            .catch(error => console.error('Error sending embed:', error));
		}
	}
}

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		const data = await getRankedData();
		setInterval(async () => {return await PostEmbed(data, client)}, 60 * 1000);
	},
};