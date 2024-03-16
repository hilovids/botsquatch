const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const mysql = require('mysql');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const { hasSundayPassedSince } = require("../../utility/seachart.js");


module.exports = {
	data: new SlashCommandBuilder()
		.setName('seachart_move')
		.setDescription('Take your move action on the Sea Chart!')
        .addStringOption(option => option.setName('seachart_space').setDescription("The space to move to."))
        .setDefaultMemberPermissions(0),
	async execute(interaction) {
        const discordUser = interaction.user;
        console.log(discordUser);

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });

        connection.query(updateQuery, async (err, result) => {
            if (err) {
                console.error('Error executing query:', err);
                return;
            }
        });

        const getQuery = `
            SELECT * FROM camp_hilo WHERE user_id = ${discordUser.id}
        `;

        connection.query(getQuery, async (err, result) => {
            if (err) {
                console.error('Error executing query:', err);
                return;
            }

            const data = result[0];
            console.log(result);

            if(data == undefined){
                const exampleEmbed = new EmbedBuilder()
                .setColor(0xFEB316)
                .setTitle(`You aren't in the system! `)
                .setURL('https://hilovids.github.io/camp-hilo/index.html')
                .setDescription(`Wave hello using /hello command.`)
                .setThumbnail('https://imgur.com/mfc6IFp.png')
                .setTimestamp()
                await interaction.reply({ embeds: [exampleEmbed] });
                return;
            }
            
            // check time to make sure the new week has elapsed
            if(!hasSundayPassedSince(data.seachart_move)){
                const exampleEmbed = new EmbedBuilder()
                .setColor(0xFEB316)
                .setTitle(`You already used this command this week.`)
                .setURL('https://hilovids.github.io/camp-hilo/index.html')
                .setDescription(`Try again after this Sunday.`)
                .setThumbnail('https://imgur.com/mfc6IFp.png')
                .setTimestamp()
                await interaction.reply({ embeds: [exampleEmbed] });
                return;
            }


        });

        connection.end();
    }
};

