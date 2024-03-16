const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const mysql = require('mysql');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('goldstar')
		.setDescription('Assign a gold star to a camper!')
        .addUserOption(option => option.setName('user').setDescription("The camper getting the gold star.").setRequired(true))
        .setDefaultMemberPermissions(0),
	async execute(interaction) {
        const discordUser = interaction.options.getUser("user");

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });
        
        // Adds user if they do not exist
        const updateQuery = `
            INSERT INTO camp_hilo (user_id, user_name, goldstars_count)
            VALUES (${discordUser.id}, "${discordUser.username}", 1)
            ON DUPLICATE KEY UPDATE 
                goldstars_count = goldstars_count + 1,
                user_name = "${discordUser.username}";
        `;

        connection.query(updateQuery, async (err, result) => {
            if (err) {
                console.error('Error executing query:', err);
                return;
            }
        });

        const getQuery = `
            SELECT goldstars_count FROM camp_hilo WHERE user_id = ${discordUser.id}
        `;

        connection.query(getQuery, async (err, result) => {
            if (err) {
                console.error('Error executing query:', err);
                return;
            }

            const stars = result[0].goldstars_count;

            const exampleEmbed = new EmbedBuilder()
            .setColor(0xFEB316)
            .setTitle(`${discordUser.username} gets a Gold Star!`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`Wow! Congrats! You now have... ${stars} in total.`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
        });

        connection.end();
    }
};