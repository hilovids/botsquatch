const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

function generatePassword(len = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Register as a player (creates your player record)')
        .addStringOption(opt => opt.setName('displayname').setDescription('Display name (optional)').setRequired(false))
        .addStringOption(opt => opt.setName('pronouns').setDescription('Pronouns (optional)').setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guild.id;
        const channelId = interaction.channel.id;

        try {
            const db = await connectToMongo();
            const campersCol = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');

            const discordConfig = await discordConfigs.findOne({ server_id: guildId });

            // prevent using the campground channel as a confessional
            if (discordConfig && discordConfig.campground_id && String(discordConfig.campground_id) === String(channelId)) {
                await interaction.editReply({ content: 'You cannot run /join in the campground channel. Please run this command in your personal confessional channel.', ephemeral: true });
                return;
            }

            // ensure player doesn't already exist
            const existing = await campersCol.findOne({ discordId: interaction.user.id });
            if (existing) {
                await interaction.editReply({ content: 'A player record already exists for your account.', ephemeral: true });
                return;
            }

            const displayName = interaction.options.getString('displayname') || (interaction.member && interaction.member.displayName) || interaction.user.username;
            const pronouns = interaction.options.getString('pronouns') || null;

            const pwd = generatePassword(10);

            const playerDoc = {
                displayName,
                username: interaction.user.username,
                pronouns,
                discordId: interaction.user.id,
                confessionalId: channelId,
                password: pwd,
                team: 'none',
                originalTeam: 'none',
                inventory: {
                    coins: 0,
                    stars: 0,
                    voteTokens: 0,
                    immunityTokens: 0,
                    seanceTokens: 0,
                    timeTokens: 0,
                    nothingTokens: 0,
                    eggToken: 0
                },
                curses: { noVote: false, silent: false, confused: false },
                badges: [],
                avatarSettings: { hairStyle: 0, hairColor: 0, facialHair: 0, facialHairColor: 0, eyeColor: 0, skinTone: 0, shirt: 0, pants: 0, accessories: [], shoes: 0 },
                roomSettings: { sheets: 0, pillow: 0, wallDecoration: 0, bedDecoration: 0 },
                lastDredged: new Date('2023-11-01T00:00:00Z'),
                lastSentMessage: new Date(),
                eliminated: false,
                admin: false
            };

            const res = await campersCol.insertOne(playerDoc);

            // send an embed to the confessional channel with the generated password and pin it
            try {
                const chan = await interaction.client.channels.fetch(channelId).catch(() => null);
                if (chan) {
                    const embed = new EmbedBuilder()
                        .setTitle('Player Registration')
                        .setDescription(`Welcome, **${displayName}**! Your player record has been created.`)
                        .setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff)
                        .addFields(
                            { name: 'Website Password', value: `${pwd}` },
                            { name: 'Confessional', value: `<#${channelId}>` }
                        );

                    const msg = await chan.send({ embeds: [embed] }).catch(() => null);
                    try { if (msg && msg.pin) await msg.pin().catch(() => {}); } catch (e) {}
                }
            } catch (e) { console.error('error sending/pinning registration embed', e); }

                // assign Camper role if configured and user doesn't already have it
                let roleAssigned = false;
                try {
                    const camperRoleId = discordConfig && (discordConfig.camper_role_id || discordConfig.camper_role);
                    if (camperRoleId) {
                        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                        if (member && !member.roles.cache.has(camperRoleId)) {
                            await member.roles.add(camperRoleId).catch(() => {});
                            roleAssigned = true;
                        }
                    }
                } catch (e) { console.error('error assigning camper role', e); }

                let replyMsg = `Player record created (${res.insertedId}). Your confessional channel is ${channelId}.`;
                if (roleAssigned) replyMsg += ' Camper role assigned.';
                await interaction.editReply({ content: replyMsg, ephemeral: true });

        } catch (err) {
            console.error('join command error', err);
            try { await interaction.editReply({ content: 'There was an error creating your player record.', ephemeral: true }); } catch (e) {}
        }
    }
};