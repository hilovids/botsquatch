const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const mysql = require('mysql');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('hello')
		.setDescription('Sets preliminary info.')
        .addStringOption(option => option.setName('preferred_name').setDescription("How you'd like to appear in the system").setRequired(true))
        .addStringOption(option => option.setName('seachart_space').setDescription("Where you'd like your boat to start")).setRequired(true)
        .setDefaultMemberPermissions(0),
	async execute(interaction) {
        const discordUser = interaction.options.getUser("user");
        const preferredName = interaction.options.getString("preferred_name");
        const seachartSpace = interaction.options.getUser("seachart_space");

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });
        
        // Adds user if they do not exist
        const updateQuery = `
            INSERT INTO camp_hilo (user_id, user_name, preferred_name, seachart_loc)
            VALUES (${discordUser.id}, "${discordUser.username}", "${preferredName}", "${seachartSpace}")
            ON DUPLICATE KEY UPDATE 
                user_name = "${discordUser.username}
                preferred_name = "${preferredName}
                seachart_loc = "${seachartSpace}"
        `;

        connection.query(updateQuery, async (err, result) => {
            if (err) {
                console.error('Error executing query:', err);
                return;
            }

            const exampleEmbed = new EmbedBuilder()
            .setColor(0xFEB316)
            .setTitle(` Welcome to Camp Hilo ${preferredName}!`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`Thank you for playing ~`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
        });

        connection.end();
    }
};