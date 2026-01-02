const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const mysql = require('mysql');

getUsers = (connection) => {
    return new Promise((resolve, reject)=>{
        const getQuery = `
            SELECT * FROM camp_hilo ORDER BY goldstars_count DESC;
        `;
        connection.query(getQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            console.log("Getting MySQL Entries - sc_hello");
            return resolve(results);
        });
    });
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName('stars')
		.setDescription('See how many gold stars everyone has!'),
	async execute(interaction) {

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });

        const getResponse = await getUsers(connection);
        
        let starsText = "";
        getResponse.forEach(element => {
            starsText += `${element.preferred_name} - ${element.goldstars_count}\n`
        });

        const exampleEmbed = new EmbedBuilder()
        .setColor(0xFEB316)
        .setTitle(`The Star Count`)
        .setURL('https://hilovids.github.io/camp-hilo/index.html')
        .setDescription(`${starsText}`)
        .setThumbnail('https://imgur.com/mfc6IFp.png')
        .setTimestamp()
        await interaction.reply({ embeds: [exampleEmbed] });
        connection.end();
    }
};