const { SlashCommandBuilder } = require('discord.js');
const { EmbedBuilder } = require('discord.js');
const { mySql_host, mySql_password, mySql_port, mySql_user, mySql_database} = require('../../config.json');
const mysql = require('mysql');
const { isValidGridSpace } = require("../../utility/seachartUtility.js");

getUser = (connection, discordUser) => {
    return new Promise((resolve, reject)=>{
        const getQuery = `
            SELECT * FROM camp_hilo WHERE user_id = ${discordUser.id}
        `;
        connection.query(getQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            console.log("Getting MySQL Entry - sc_hello");
            return resolve(results);
        });
    });
};

updateInfo = (connection, discordUser, preferredName, seachartSpace) => {
    return new Promise((resolve, reject)=>{
        const updateQuery = `
            INSERT INTO camp_hilo (user_id, user_name, preferred_name, seachart_loc)
            VALUES (${discordUser.id}, "${discordUser.username}", "${preferredName}", "${seachartSpace}")
            ON DUPLICATE KEY UPDATE 
                user_name = "${discordUser.username}",
                preferred_name = "${preferredName}",
                seachart_loc = "${seachartSpace}";
        `;
        connection.query(updateQuery,  (error, results)=>{
            if(error){
                return reject(error);
            }
            console.log("Updating/Creating MySQL Entry - sc_hello");
            return resolve(results);
        });
    });
};

module.exports = {
	data: new SlashCommandBuilder()
		.setName('hello')
		.setDescription('Sets preliminary info.')
        .addStringOption(option => option.setName('preferred_name').setDescription("How you'd like to appear in the system").setRequired(true))
        .addStringOption(option => option.setName('seachart_space').setDescription("Where you'd like your boat to start").setRequired(true)),
	async execute(interaction) {
        const discordUser = interaction.user;
        const preferredName = interaction.options.getString("preferred_name");
        const seachartSpace = interaction.options.getString("seachart_space");

        const connection = mysql.createConnection({
            host: mySql_host,
            port: mySql_port,
            user: mySql_user,
            password: mySql_password,
            database: mySql_database
        });
        
        //validation
        if (!isValidGridSpace(seachartSpace)){
            const exampleEmbed = new EmbedBuilder()
            .setColor(0x417505)
            .setTitle(`Invalid Space Format`)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`I don't know what space that is because I'm dumb and bigfoot. Try formatting it like A1 or a1`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
            return;
        }

        const getResponse = await getUser(connection, discordUser);
        const getData = getResponse[0];

        if(getData != undefined){
            const exampleEmbed = new EmbedBuilder()
            .setColor(0x417505)
            .setTitle(`You are already in the system! `)
            .setURL('https://hilovids.github.io/camp-hilo/index.html')
            .setDescription(`DM hilo for name or initial space changes.`)
            .setThumbnail('https://imgur.com/mfc6IFp.png')
            .setTimestamp()
            await interaction.reply({ embeds: [exampleEmbed] });
            connection.end();
            return;
        }

        // Adds user if they do not exist
        const updateResponse = await updateInfo(connection, discordUser, preferredName, seachartSpace);

        const exampleEmbed = new EmbedBuilder()
        .setColor(0x417505)
        .setTitle(` Welcome to Camp Hilo, ${preferredName}!`)
        .setURL('https://hilovids.github.io/camp-hilo/index.html')
        .setDescription(`Thank you for playing ~`)
        .setThumbnail('https://imgur.com/mfc6IFp.png')
        .setTimestamp()
        await interaction.reply({ embeds: [exampleEmbed] });
        connection.end();
    }
};