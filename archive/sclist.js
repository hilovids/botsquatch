const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const mysql = require('mysql');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const { getList } = require("../../utility/seachartUtility.js");

function getUser(connection){
    return new Promise((resolve, reject)=>{
        const getQuery = `
            SELECT * FROM camp_hilo
        `;
        connection.query(getQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            console.log("Getting MySQL Entries - sc_list");
            return resolve(results);
        });
    });
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName('seachart_list')
		.setDescription('Shows where everyone is on the Sea Chart'),
	async execute(interaction) {
        const discordUser = interaction.user;

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });

        const getResponse = await getUser(connection, discordUser);
        const userData = getResponse;

        const exampleEmbed = new EmbedBuilder()
        .setColor(0x003280)
        .setTitle(`The Sea Chart`)
        .setURL('https://hilovids.github.io/camp-hilo/index.html')
        .setDescription(getList(userData))
        .setThumbnail('https://imgur.com/mfc6IFp.png')
        .setTimestamp()
        await interaction.reply({ embeds: [exampleEmbed] });
        connection.end();
    }
};

