const { getRankedData } = require("../utility/leagueUtility.js");
const { league_channelId, league_serverId } = require('../config.json');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../config.json');
const { Events, EmbedBuilder } = require('discord.js');
const mysql = require('mysql');

async function PostEmbed(data, client){
	let gamesPlayed = data.wins + data.losses;

	const connection = mysql.createConnection({
		host: mySql_host,
		port: mySql_port,
		user: mySql_user,
		password: mySql_password,
		database: mySql_database
	});

	let gameData = await loadSavedData(connection);

	console.log("New: ", gamesPlayed);
	console.log("Old: ", gameData[0].goldstars_count);

	if(gamesPlayed != gameData[0].goldstars_count){
		await saveData(connection, gamesPlayed);
		let formattedString = `Brooks is currently ${data.tier} ${data.rank}, ${data.leaguePoints}LP\n${data.wins}W - ${data.losses}L`
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
	
		const guildId = league_serverId;
		const guild = client.guilds.cache.get(guildId);
	
		if (guild) {
			try {
				const newName = `${data.tier} ${data.rank}, ${data.leaguePoints}LP`;
				await guild.setName(newName);
				console.log(`Server name changed to: ${guild.name}`);
			} catch (error) {
				console.error('Error changing server name:', error);
			}
		} else {
			console.error('Guild not found.');
		}
	} 
	else {
		console.log("No change...");
	}
}

function loadSavedData(connection) {
    return new Promise((resolve, reject)=>{
        const getQuery = `
            SELECT * FROM camp_hilo WHERE user_id = "brooks"
        `;
        connection.query(getQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            console.log("Getting MySQL Entry - goldstar");
            return resolve(results);
        });
    });
}

function saveData(connection, gamesPlayed) {
    return new Promise((resolve, reject)=>{
        const updateQuery = `
            INSERT INTO camp_hilo (user_id, goldstars_count)
            VALUES ("brooks", 0)
            ON DUPLICATE KEY UPDATE 
                goldstars_count = ${gamesPlayed};
        `;
        connection.query(updateQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            console.log("Updating MySQL Entries - goldstar");
            return resolve(results);
        });
    });
}

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		const data = await getRankedData();
		setInterval(async () => {return await PostEmbed(data, client)}, 5 * 3 * 1000);
	},
};