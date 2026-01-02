const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote_start')
        .setDescription('Begin an elimination vote.')
        .addStringOption(option =>
            option.setName('vote_type')
                .setDescription('The type of vote to start.')
                .setRequired(true)
                .addChoices(
                    { name: 'Witless Wolves', value: 'wolves' },
                    { name: 'Foolish Ferrets', value: 'ferrets' },
                    { name: 'All Campers', value: 'all' },
                )
        )
        .addStringOption(option =>
            option.setName('vote_end')
                .setDescription('Formatted timestamp for when the vote ends.')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(0),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const team = interaction.options.get('vote_type')?.value || 'all';
        const voteEnd = interaction.options.get('vote_end')?.value || '';

        const guildId = interaction.guild.id;

        const client = interaction.client;

        console.log('vote_start invoked', { guildId, team });

        try {
            const db = await connectToMongo();
            const ceremonies = db.collection('ceremonies');
            const campersCol = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');

            const discordConfig = await discordConfigs.findOne({ "server_id": guildId });

            // console.log('discordConfig', discordConfig);

            const currentWeek = discordConfig ? (discordConfig.current_week) : 1;

            // quick check: make sure there's not already an active ceremony for this week
            const existing = await ceremonies.findOne({ guildId, week: currentWeek, active: true });
            if (existing) {
                await interaction.editReply({ content: `A vote is already active for Week ${currentWeek}.`, ephemeral: true });
                return;
            }

            const ceremonyDoc = {
                guildId,
                team,
                week: currentWeek,
                createdAt: new Date(),
                active: true,
                immunity: [],
                votes: []
            };

            const insertRes = await ceremonies.insertOne(ceremonyDoc);

            function parseColor(c) {
                if (!c) return 0xFEB316;
                if (typeof c === 'number') return c;
                if (typeof c === 'string') {
                    let s = c.trim();
                    if (s.startsWith('#')) s = s.slice(1);
                    if (s.startsWith('0x')) s = s.slice(2);
                    const num = parseInt(s, 16);
                    if (!isNaN(num)) return num;
                    const asNum = parseInt(s, 10);
                    if (!isNaN(asNum)) return asNum;
                }
                return 0xFEB316;
            }

            const color = parseColor(discordConfig && discordConfig.embed && discordConfig.embed.color);
            const thumbnail = (discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url) ? discordConfig.embed.thumbnail_url : '';

            const query = { eliminated: { $ne: true } };
            if (team !== 'all') query.team = team;
            const formattedTeam = team === 'wolves' ? 'Witless Wolves' : `Foolish Ferrets`;

            let campground;
            try { campground = await client.channels.fetch(discordConfig.campground_id); } catch (e) { campground = null; }

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle("The Week " + (discordConfig ? discordConfig.current_week : 1) + " Elimination Ceremony has Begun!")
                .setDescription(`An elimination vote has begun for ${team === 'all' ? 'all campers' : 'the **' + formattedTeam + '**'}. \n\n**Voting Ends:** ${voteEnd}`)
                .setThumbnail(thumbnail)

            await campground.send({ embeds: [embed] });

            let sent = 0;
            const campers = await campersCol.find(query).toArray();

            // build select options for quick votes (max 25)
            const selectOptions = campers.slice(0, 25).map(c => ({
                label: c.displayName || c.username || c.discordId,
                value: String(c.discordId)
            }));

            for (const camper of campers) {
                const channelId = camper.confessionalId;

                try {
                    if (channelId) {
                        let channel;
                        try { channel = await client.channels.fetch(channelId); } catch (e) { channel = client.channels.cache.get(channelId); }
                        if (channel) {

                            const title = `Week ${discordConfig ? (discordConfig.current_week) : 1} Elimination Ceremony - ${camper.displayName || camper.username || 'Camper'}`;
                            const desc = `The elimination ceremony for Week ${discordConfig ? (discordConfig.current_week) : 1} has begun. \n\n To vote, you can use the select option below for a quick vote, or you can customize and upload your vote board using the **/vote** command.`;
                            const extraVoteText = (camper.inventory.voteTokens || 0) > 0 ? `\n\nYou have **${camper.inventory.voteTokens || 0}** extra vote(s)! You may use the **/vote_extra** command to cast extra votes.` : '';

                            const embed = new EmbedBuilder()
                                .setColor(color)
                                .setTitle(title)
                                .setDescription(desc + extraVoteText + `\n\n**Voting Ends:** ${voteEnd}`)
                                .setThumbnail(thumbnail)
                                .setImage('attachment://vote_board.png')

                            // select menu of eligible targets (quick vote)
                            const select = new StringSelectMenuBuilder()
                                .setCustomId(`quick_vote_select:${team}`)
                                .setPlaceholder('Quick Vote: Choose a Camper!')
                                .setMinValues(1)
                                .setMaxValues(1)
                                .addOptions(selectOptions);

                            const selectRow = new ActionRowBuilder().addComponents(select);

                            await channel.send({ content: `<@${camper.discordId}> A vote has begun!`, embeds: [embed], files: [{ attachment: path.join(__dirname, '..', '..', 'assets', 'vote_board.png'), name: 'vote_board.png' }], components: [selectRow] });
                            sent++;
                            continue;
                        }
                        else {
                            console.warn('Channel not found for camper', camper._id, channelId);
                        }
                    }
                } catch (err) {
                    console.error('Error sending embed to camper', camper._id, err);
                }
            }

            await interaction.editReply({ content: `Ceremony created (${insertRes.insertedId}). Sent to ${sent} campers.`, ephemeral: true });

        } catch (err) {
            console.error('vote_start error', err);
            await interaction.editReply({ content: 'There was an error creating the ceremony.', ephemeral: true });
        }
    }
};