const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');

const JOIN_TIMEOUT = 30 * 1000; // 30s for join/wagers/choices

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Challenge another player to Rock Paper Scissors'),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const db = await connectToMongo();
            const campers = db.collection('campers');
            const discordConfig = await db.collection('discordConfigs').findOne({ server_id: interaction.guildId });
            const embedColor = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff;
            const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;

            const challenger = await campers.findOne({ discordId: interaction.user.id });
            if (!challenger) {
                const e = new EmbedBuilder().setTitle('Profile Not Found').setDescription('You must have a camper profile to start an RPS match.').setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                await interaction.editReply({ embeds: [e], ephemeral: true });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('Rock — Paper — Scissors — Hand of the Elder Beast')
                .setDescription(`${interaction.user} has challenged anyone to a match! Click JOIN GAME to accept.`)
                .setColor(embedColor)
                .setTimestamp();
            if (thumbnail) embed.setThumbnail(thumbnail);

            const challengerBtn = new ButtonBuilder().setCustomId(`rps:challenger:${interaction.user.id}`).setLabel(`${interaction.user.username}`).setStyle(ButtonStyle.Secondary).setDisabled(true);
            const joinBtn = new ButtonBuilder().setCustomId('rps:join').setLabel('JOIN GAME').setStyle(ButtonStyle.Primary);
            const row = new ActionRowBuilder().addComponents(challengerBtn, joinBtn);

            const msg = await interaction.editReply({ embeds: [embed], components: [row] });

            // wait for someone else to click join
            const filter = i => i.customId === 'rps:join' && i.user.id !== interaction.user.id;
            try {
                const joinInteraction = await msg.awaitMessageComponent({ filter, time: JOIN_TIMEOUT });
                // validate joiner profile
                const joinerDoc = await campers.findOne({ discordId: joinInteraction.user.id });
                if (!joinerDoc) {
                    const err = new EmbedBuilder().setTitle('Profile Not Found').setDescription('You must have a camper profile to join this match.').setColor(0xFF0000);
                    if (thumbnail) err.setThumbnail(thumbnail);
                    await joinInteraction.reply({ embeds: [err], ephemeral: true });
                    // leave original message as-is but remove button
                    try { await msg.edit({ components: [] }); } catch (e) {}
                    return;
                }

                // update original message to show players and remove button
                const updated = new EmbedBuilder().setTitle('RPS — Match Ready').setDescription(`${interaction.user} vs ${joinInteraction.user}\nCheck your confessional channels to set wagers and play.`).setColor(embedColor);
                if (thumbnail) updated.setThumbnail(thumbnail);
                try { await msg.edit({ embeds: [updated], components: [] }); } catch (e) {}
                await joinInteraction.reply({ content: `You joined the match with ${interaction.user}. Check your confessional channel.`, ephemeral: true });

                // DM both players asking for wager (stars only)
                const aUser = interaction.user;
                const bUser = joinInteraction.user;
                const aDoc = challenger; // already fetched
                const bDoc = joinerDoc;

                // helper to DM and collect wager
                async function collectWager(user, doc) {
                    try {
                        if (!doc || !doc.confessionalId) {
                            const err = new EmbedBuilder().setTitle('No Confessional').setDescription('Could not find your confessional channel; match cancelled.').setColor(0xFF0000);
                            if (thumbnail) err.setThumbnail(thumbnail);
                            await interaction.followUp({ embeds: [err] });
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Cancelled').setDescription('A player has no confessional configured.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            return null;
                        }
                        const chan = await interaction.client.channels.fetch(String(doc.confessionalId)).catch(() => null);
                        if (!chan) {
                            const err = new EmbedBuilder().setTitle('Confessional Unavailable').setDescription('Could not send to your confessional channel; match cancelled.').setColor(0xFF0000);
                            if (thumbnail) err.setThumbnail(thumbnail);
                            await interaction.followUp({ embeds: [err] });
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Cancelled').setDescription('A player\'s confessional could not be reached.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            return null;
                        }
                        const embedW = new EmbedBuilder().setTitle('RPS Wager').setDescription('How many stars would you like to wager? Reply with a positive integer. You must wager at least 1 and no more than you own.').setColor(embedColor);
                        if (thumbnail) embedW.setThumbnail(thumbnail);
                        const prompt = await chan.send({ embeds: [embedW] }).catch(() => null);
                        if (!prompt) {
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Cancelled').setDescription('Could not deliver wager prompt; match cancelled.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            return null;
                        }
                        const collected = await chan.awaitMessages({ filter: m => m.author.id === user.id, max: 1, time: JOIN_TIMEOUT });
                        const reply = collected.first();
                        if (!reply) {
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Timed Out').setDescription('One or both players failed to submit a valid wager in time.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            try { await chan.send({ embeds: [new EmbedBuilder().setTitle('Timed Out').setDescription('You did not submit a wager in time.').setColor(0xFF0000)] }); } catch (e) {}
                            return null;
                        }
                        const num = parseInt(reply.content, 10);
                        const available = (doc.inventory && typeof doc.inventory.stars === 'number') ? doc.inventory.stars : 0;
                        if (!Number.isInteger(num) || num <= 0 || num > available) {
                            const err = new EmbedBuilder().setTitle('Invalid Wager').setDescription(`Invalid wager. You have ${available} stars and must wager between 1 and that amount.`).setColor(0xFF0000);
                            if (thumbnail) err.setThumbnail(thumbnail);
                            await chan.send({ embeds: [err] }).catch(() => null);
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Cancelled').setDescription('A player submitted an invalid wager.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            return null;
                        }
                        await chan.send({ content: `You wagered ${num} stars.` }).catch(() => null);
                        return num;
                    } catch (e) {
                        try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Error').setDescription('An error occurred while collecting wagers.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                        return null;
                    }
                }

                // Collect wagers in parallel but with individual timeouts
                const [aWager, bWager] = await Promise.all([collectWager(aUser, aDoc), collectWager(bUser, bDoc)]);
                if (!aWager || !bWager) {
                    // inform channel match timed out
                    const tOut = new EmbedBuilder().setTitle('Match Timed Out').setDescription('One or both players failed to submit a valid wager in time.').setColor(0xFF0000);
                    if (thumbnail) tOut.setThumbnail(thumbnail);
                    try { await msg.edit({ embeds: [tOut] }); } catch (e) {}
                    return;
                }

                // Now DM each player to make their R/P/S choice with buttons. 1% chance to show Elder Hand button per player
                async function promptChoice(user, doc) {
                    try {
                        if (!doc || !doc.confessionalId) {
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Cancelled').setDescription('A player has no confessional configured.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            return null;
                        }
                        const chan = await interaction.client.channels.fetch(String(doc.confessionalId)).catch(() => null);
                        if (!chan) {
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Cancelled').setDescription('A player\'s confessional could not be reached.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            return null;
                        }
                        const hasElder = Math.random() <= 0.01; // 1% chance
                        const em = new EmbedBuilder().setTitle('Choose Your Throw').setDescription('Select Rock, Paper, or Scissors.').setColor(embedColor);
                        if (thumbnail) em.setThumbnail(thumbnail);
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('rps_choice_rock').setLabel('Rock').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId('rps_choice_paper').setLabel('Paper').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId('rps_choice_scissors').setLabel('Scissors').setStyle(ButtonStyle.Primary)
                        );
                        if (hasElder) {
                            row.addComponents(new ButtonBuilder().setCustomId('rps_choice_elder').setLabel('Hand of the Elder Beast').setStyle(ButtonStyle.Danger));
                        }
                        const m = await chan.send({ embeds: [em], components: [row] }).catch(() => null);
                        if (!m) {
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Cancelled').setDescription('Could not deliver choice prompt; match cancelled.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            return null;
                        }
                        try {
                            const compFilter = i => i.user.id === user.id && i.customId && i.customId.startsWith('rps_choice_');
                                const choiceInt = await m.awaitMessageComponent({ filter: compFilter, time: JOIN_TIMEOUT });
                                await choiceInt.deferUpdate();
                                // remove the buttons so they can't be pressed again
                                try { await m.edit({ components: [] }).catch(() => null); } catch (e) {}
                                const id = choiceInt.customId.split('_')[2];
                                return id; // rock/paper/scissors/elder
                        } catch (e) {
                            try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Timed Out').setDescription('One or both players failed to choose in time.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                            try { await chan.send({ embeds: [new EmbedBuilder().setTitle('Timed Out').setDescription('You did not choose in time.').setColor(0xFF0000)] }); } catch (e) {}
                            return null;
                        }
                    } catch (e) {
                        try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('Match Error').setDescription('An error occurred while collecting choices.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                        return null;
                    }
                }

                const [aChoice, bChoice] = await Promise.all([promptChoice(aUser, aDoc), promptChoice(bUser, bDoc)]);
                if (!aChoice || !bChoice) {
                    const tOut = new EmbedBuilder().setTitle('Match Timed Out').setDescription('One or both players failed to choose in time.').setColor(0xFF0000);
                    if (thumbnail) tOut.setThumbnail(thumbnail);
                    try { await msg.edit({ embeds: [tOut] }); } catch (e) {}
                    return;
                }

                // Resolve match
                function outcome(choiceA, choiceB) {
                    if (choiceA === 'elder' && choiceB !== 'elder') return 'a';
                    if (choiceB === 'elder' && choiceA !== 'elder') return 'b';
                    if (choiceA === choiceB) return 'draw';
                    const beats = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
                    if (beats[choiceA] === choiceB) return 'a';
                    return 'b';
                }

                const result = outcome(aChoice, bChoice);

                // Update DB: transfer stars from loser to winner, and update stats
                // ensure fresh docs
                const freshA = await campers.findOne({ discordId: aUser.id });
                const freshB = await campers.findOne({ discordId: bUser.id });

                // helper for incrementing stats
                async function incStats(docId, incObj) {
                    if (!docId) return;
                    await campers.updateOne({ _id: docId }, { $inc: incObj }, { upsert: false });
                }

                // ensure rpsChoices object exists for counts (use $inc; if missing it will be created with values)
                await incStats(freshA._id, { 'rpsChoices.rock': aChoice === 'rock' ? 1 : 0, 'rpsChoices.paper': aChoice === 'paper' ? 1 : 0, 'rpsChoices.scissors': aChoice === 'scissors' ? 1 : 0, 'rpsChoices.hand': aChoice === 'elder' ? 1 : 0 });
                await incStats(freshB._id, { 'rpsChoices.rock': bChoice === 'rock' ? 1 : 0, 'rpsChoices.paper': bChoice === 'paper' ? 1 : 0, 'rpsChoices.scissors': bChoice === 'scissors' ? 1 : 0, 'rpsChoices.hand': bChoice === 'elder' ? 1 : 0 });

                if (result === 'a') {
                    // a wins: transfer bWager from B to A
                    await campers.updateOne({ _id: freshB._id }, { $inc: { ['inventory.stars']: -bWager } });
                    await campers.updateOne({ _id: freshA._id }, { $inc: { ['inventory.stars']: bWager } });
                    await incStats(freshA._id, { rpsWins: 1 });
                    await incStats(freshB._id, { rpsLosses: 1 });
                } else if (result === 'b') {
                    await campers.updateOne({ _id: freshA._id }, { $inc: { ['inventory.stars']: -aWager } });
                    await campers.updateOne({ _id: freshB._id }, { $inc: { ['inventory.stars']: aWager } });
                    await incStats(freshB._id, { rpsWins: 1 });
                    await incStats(freshA._id, { rpsLosses: 1 });
                } else {
                    // draw: no transfers
                }

                // prepare result embed to post in channel and DM summaries
                const displayChoice = c => c === 'elder' ? 'Hand of the Elder Beast' : c.charAt(0).toUpperCase() + c.slice(1);
                let desc = `${aUser} chose **${displayChoice(aChoice)}**.\n${bUser} chose **${displayChoice(bChoice)}**.\n`;
                if (result === 'a') desc += `\n${aUser} wins and takes ${bWager} stars from ${bUser}!`;
                else if (result === 'b') desc += `\n${bUser} wins and takes ${aWager} stars from ${aUser}!`;
                else desc += `\nIt's a draw — no stars exchanged.`;

                const resEmbed = new EmbedBuilder().setTitle('RPS — Result').setDescription(desc).setColor(result === 'a' ? 0x00FF00 : result === 'b' ? 0x00FF00 : 0xFFFF00);
                if (thumbnail) resEmbed.setThumbnail(thumbnail);
                try { await interaction.followUp({ embeds: [resEmbed] }); } catch (e) {}

                // DM both with their final inventories
                const finalA = await campers.findOne({ _id: freshA._id });
                const finalB = await campers.findOne({ _id: freshB._id });
                try {
                    if (freshA.confessionalId) {
                        const cA = await interaction.client.channels.fetch(String(freshA.confessionalId)).catch(() => null);
                        if (cA) await cA.send({ embeds: [new EmbedBuilder().setTitle('Match Result').setDescription(desc).addFields({ name: 'Stars', value: `${(finalA.inventory && finalA.inventory.stars) || 0}` }).setColor(embedColor)] }).catch(() => null);
                    }
                } catch (e) {}
                try {
                    if (freshB.confessionalId) {
                        const cB = await interaction.client.channels.fetch(String(freshB.confessionalId)).catch(() => null);
                        if (cB) await cB.send({ embeds: [new EmbedBuilder().setTitle('Match Result').setDescription(desc).addFields({ name: 'Stars', value: `${(finalB.inventory && finalB.inventory.stars) || 0}` }).setColor(embedColor)] }).catch(() => null);
                    }
                } catch (e) {}

            } catch (e) {
                // join timeout
                try { await msg.edit({ embeds: [new EmbedBuilder().setTitle('No Join').setDescription('No one joined the match in time.').setColor(0xFF0000)], components: [] }); } catch (e) {}
                return;
            }

        } catch (err) {
            console.error('rps command error', err);
            try { await interaction.editReply({ content: 'There was an error starting RPS.' }); } catch (e) {}
        }
    }
};
