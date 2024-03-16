const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const mysql = require('mysql');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('seestars')
		.setDescription('See how many gold stars everyone has!'),
	async execute(interaction) {
        const discordUser = interaction.options.getUser("user");

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });

        const getQuery = `
            SELECT * FROM camp_hilo ORDER BY goldstars_count;
        `;

        connection.query(getQuery, async (err, result) => {
            if (err) {
                console.error('Error executing query:', err);
                return;
            }
            
            let starsText = "";
            result.forEach(element => {
                starsText += `${element.user_name} - ${element.goldstars_count}\n`
            });
            const stars = result;

            const exampleEmbed = new EmbedBuilder()
            .setColor(0xFEB316)
            .setTitle(`The Star Count`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`${starsText}`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.channel.send({ embeds: [exampleEmbed] });
        });

        connection.end();
    }
};