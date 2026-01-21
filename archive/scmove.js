const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const mysql = require('mysql');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database, restdb_url, restdb_apikey} = require('../../config.json');
const { hasSundayPassedSince, isValidGridSpace, distanceBetweenSpaces } = require("../../utils/seachart.js");
var request = require("request");

function getUser(connection, discordUser){
    return new Promise((resolve, reject)=>{
        const getQuery = `
            SELECT * FROM camp_hilo WHERE user_id = ${discordUser.id}
        `;
        connection.query(getQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            console.log("Getting MySQL Entry - sc_move");
            return resolve(results);
        });
    });
};

function updateInfo(connection, discordUser, space){
    return new Promise((resolve, reject)=>{
        console.log("Posting MySQL Entry - sc_move");
        const time = Date.now().toString();
        const updateQuery = `
            INSERT INTO camp_hilo (user_id, seachart_loc, seachart_move)
            VALUES (${discordUser.id}, "${space}", ${time})
            ON DUPLICATE KEY UPDATE 
                seachart_loc = "${space}",
                seachart_move = "${time}";
        `;
        connection.query(updateQuery,  (error, results)=>{
            if(error){
                console.log(error);
                return reject(error);
            }
            console.log("Updating MySQL Entry - sc_move");
            return resolve(results);
        });
    });
};

function DeleteValuesInRest(name) {
    return new Promise((resolve, reject) => {
        let optionsDelete = {
            method: 'DELETE',
            url: `${restdb_url}/*?q={"preferred_name": "${name}"}`,
            headers: {
                'cache-control': 'no-cache',
                'x-apikey': 'e144ad2151c6cdbdd722067cf3366f8f4c518',
                'content-type': 'application/json'
            }
        };

        request(optionsDelete, function (error, response, body) {
            if (error){
                console.log(error);
                return reject(error);
            }
            else {
                console.log("Deleting RestDb Entries - sc_move");
                return resolve(body)
            }
        });
    });
}

function PostInfoToRest(id, name, space) {
    return new Promise((resolve, reject) => {
        let options = {
            method: 'POST',
            url: restdb_url,
            headers:
            {
                'cache-control': 'no-cache',
                'x-apikey': restdb_apikey,
                'content-type': 'application/json'
            },
            body: { discordId: id, preferred_name: name, seachart_loc: space },
            json: true
        };

        request(options, function (error, response, body) {
            if (error) {
                console.log(error);
                reject(error);
            }
            console.log("Posting RestDb Entry - sc_move");
            resolve(body);
        });
    });
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('seachart_move')
		.setDescription('Take your move action on the Sea Chart!')
        .addStringOption(option => option.setName('seachart_space').setDescription("The space to move to.").setRequired(true)),
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

        if(distanceBetweenSpaces(userData.seachart_loc.toLowerCase(), seachartSpace.toLowerCase()) > 2){
            const exampleEmbed = new EmbedBuilder()
            .setColor(0x003280)
            .setTitle(`Your ship isn't that fast.`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`You can only move up to 2 spaces.`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
            connection.end();
            return;
        }

        //console.log("spaces are close to each other");

        // check time to make sure the new week has elapsed
        if(!hasSundayPassedSince(userData.seachart_move)){
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

        await updateInfo(connection, discordUser, seachartSpace);
        await DeleteValuesInRest(userData.preferred_name)
        await PostInfoToRest(discordUser.id, userData.preferred_name, seachartSpace);

        const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`You moved to ${seachartSpace}.`)
        .setURL('https://hilovids.github.io/camp-hilo/index.html')
        .setDescription(`You can move again after next Sunday!`)
        .setThumbnail('https://imgur.com/mfc6IFp.png')
        .setTimestamp()
        await interaction.reply({ embeds: [exampleEmbed] });
        connection.end();
    }
};



