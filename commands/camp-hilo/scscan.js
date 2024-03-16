const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const mysql = require('mysql');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const { hasSundayPassedSince, isValidGridSpace, distanceBetweenSpaces, scanResult } = require("../../utility/seachartUtility.js");

function getUser(connection, discordUser){
    return new Promise((resolve, reject)=>{
        const getQuery = `
            SELECT * FROM camp_hilo WHERE user_id = ${discordUser.id}
        `;
        connection.query(getQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            // console.log(results);
            return resolve(results);
        });
    });
};

function updateInfo(connection, discordUser){
    return new Promise((resolve, reject)=>{
        const time = Date.now().toString();
        const updateQuery = `
            INSERT INTO camp_hilo (user_id, seachart_scan)
            VALUES (${discordUser.id}, ${time})
            ON DUPLICATE KEY UPDATE 
            seachart_scan = "${time}";
        `;
        connection.query(updateQuery,  (error, results)=>{
            if(error){
                console.log(error);
                return reject(error);
            }
            return resolve(results);
        });
    });
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName('seachart_scan')
		.setDescription('Take your scan action on the Sea Chart!')
        .addStringOption(option => option.setName('seachart_space').setDescription("The space to scan.").setRequired(true)),
	async execute(interaction) {
        const discordUser = interaction.user;
        const seachartSpace = interaction.options.getString("seachart_space");

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });

        const getResponse = await getUser(connection, discordUser);
        const userData = getResponse[0];

        if(userData == undefined){
            const exampleEmbed = new EmbedBuilder()
            .setColor(0x003280)
            .setTitle(`You aren't in the system! `)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`Wave hello using /hello command.`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
            connection.end();
            return;
        }

        //console.log("player exists");

        if (!isValidGridSpace(seachartSpace)){
            const exampleEmbed = new EmbedBuilder()
            .setColor(0x003280)
            .setTitle(`Invalid Space Format`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`I don't know what space that is because I'm dumb and bigfoot. Try formatting it like A1 or a1`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
            connection.end();
            return;
        }

        //console.log("spaces are valid");

        if(distanceBetweenSpaces(userData.seachart_loc.toLowerCase(), seachartSpace.toLowerCase()) > 1){
            const exampleEmbed = new EmbedBuilder()
            .setColor(0x003280)
            .setTitle(`Your ship can't reach that spot.`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`You can only scan up to 1 space away.`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
            connection.end();
            return;
        }

        // check time to make sure the new week has elapsed
        if(!hasSundayPassedSince(userData.seachart_scan)){
            const exampleEmbed = new EmbedBuilder()
            .setColor(0x003280)
            .setTitle(`You already used this command this week.`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`Try again after this Sunday.`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
            connection.end();
            return;
        }

        await updateInfo(connection, discordUser);

        const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`You scanned ${seachartSpace}.`)
        .setURL('https://hilovids.github.io/camp-hilo/index.html')
        .setDescription(scanResult(seachartSpace))
        .setThumbnail('https://imgur.com/mfc6IFp.png')
        .setTimestamp()
        await interaction.reply({ embeds: [exampleEmbed] });
        connection.end();
    }
};

