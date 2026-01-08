const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('./mongodbUtil');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

// in-memory sessions: sessionId -> { userId, guildId, type, state, timeout }
const sessions = new Map();

function fileExists(p) {
    try { return fs.existsSync(p); } catch (e) { return false; }
}

// Standardized helper to apply $inc to gambling_state with logging
async function applyGambleInc(db, incObj, context = '') {
    try {
        const col = db.collection('gambling_state');
        console.log('applyGambleInc', context, incObj);
        const res = await col.updateOne({ _id: 'global' }, { $inc: incObj }, { upsert: true });
        console.log('applyGambleInc result', context, res && res.result ? res.result : res);
        return res;
    } catch (e) {
        console.error('applyGambleInc error', context, e);
        throw e;
    }
}

// Standardized helper for player inventory updates with logging
async function applyPlayerInc(collection, filter, incObj, context = '') {
    try {
        console.log('applyPlayerInc', context, filter, incObj);
        const res = await collection.updateOne(filter, { $inc: incObj });
        console.log('applyPlayerInc result', context, res && res.result ? res.result : res);
        return res;
    } catch (e) {
        console.error('applyPlayerInc error', context, e);
        throw e;
    }
}

function _randInt(max) { return Math.floor(Math.random() * max); }

async function ensureGambleState(db) {
    const col = db.collection('gambling_state');
    function computeNextMidnight(now) {
        const next = new Date(now);
        next.setHours(0,0,0,0);
        next.setDate(next.getDate() + 1);
        return next;
    }

    function computeNextSundayMidnight(now) {
        const next = new Date(now);
        next.setHours(0,0,0,0);
        const day = next.getDay(); // 0 = Sunday
        const daysUntil = (7 - day) % 7 || 7; // ensure next Sunday (not today)
        next.setDate(next.getDate() + daysUntil);
        return next;
    }

    let doc = await col.findOne({ _id: 'global' });
    const now = new Date();
    if (!doc) {
        const seed = {
            _id: 'global',
            starsPool: 10,
            rocks: 10,
            papers: 10,
            scissors: 10,
            elderHand: 1,
            lastPayoutAt: new Date(0),
            lastPayoutRecipient: null,
            // persistent reset timestamps so a bot restart doesn't lose schedule
            nextDailyResetAt: computeNextMidnight(now),
            nextWeeklyCashoutAt: computeNextSundayMidnight(now),
            stats: {
                cardWins: 0,
                cardLosses: 0,
                bjWins: 0,
                bjLosses: 0,
                rpsWins: 0,
                rpsLosses: 0,
                totalPayouts: 0,
                totalBets: 0
            }
        };
        await col.insertOne(seed);
        return seed;
    }

    // If timestamps are missing or in the past, refresh them so timers survive restarts
    const updates = {};
    if (!doc.nextDailyResetAt || new Date(doc.nextDailyResetAt) <= now) updates.nextDailyResetAt = computeNextMidnight(now);
    if (!doc.nextWeeklyCashoutAt || new Date(doc.nextWeeklyCashoutAt) <= now) updates.nextWeeklyCashoutAt = computeNextSundayMidnight(now);
    if (Object.keys(updates).length > 0) {
        await col.updateOne({ _id: 'global' }, { $set: updates });
        doc = await col.findOne({ _id: 'global' });
    }

    return doc;
}

function findImage(assetsDir, base) {
    const jpg = path.join(assetsDir, base + '.jpg');
    if (fileExists(jpg)) return jpg;
    const png = path.join(assetsDir, base + '.png');
    if (fileExists(png)) return png;
    return null;
}

async function getDiscordConfig(db, guildId) {
    try { return await db.collection('discordConfigs').findOne({ server_id: guildId }); } catch (e) { return null; }
}

function makeTimeout(sessionId, ms = 3 * 60 * 1000) {
    return setTimeout(async () => {
        const s = sessions.get(sessionId);
        if (!s) return;
        try {
            if (s.message && s.message.edit) {
                const embed = new EmbedBuilder().setTitle('Gamble Timed Out').setDescription('You did not respond in time.').setColor(0xFF0000);
                try { await s.message.edit({ embeds: [embed], components: [] }); } catch (e) {}
            }
        } catch (e) { console.error('gamble timeout error', e); }
        sessions.delete(sessionId);
    }, ms);
}

async function startGamble(interaction, game, betType, betAmount) {
    const db = await connectToMongo();
    const campers = db.collection('campers');
    const gambleState = await ensureGambleState(db);
    const discordConfig = await getDiscordConfig(db, interaction.guildId);
    const embedColor = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff;
    const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;

    const player = await campers.findOne({ discordId: interaction.user.id });
    if (!player) {
        const errEmbed = new EmbedBuilder().setTitle('Player Not Found').setDescription('Player profile not found. Use /join first.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
        if (thumbnail) errEmbed.setThumbnail(thumbnail);
        await interaction.editReply({ embeds: [errEmbed], ephemeral: true });
        return;
    }

    if (player.eliminated) {
        const errEmbed = new EmbedBuilder().setTitle('Cannot Gamble').setDescription('Eliminated players cannot gamble.').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFF0000);
        if (thumbnail) errEmbed.setThumbnail(thumbnail);
        await interaction.editReply({ embeds: [errEmbed], ephemeral: true });
        return;
    }

    const available = (player.inventory && typeof player.inventory[betType] === 'number') ? player.inventory[betType] : 0;
    if (betAmount <= 0 || betAmount > available) {
        const errEmbed = new EmbedBuilder().setTitle('Invalid Bet').setDescription(`Invalid bet. You have ${available} ${betType}.`).setColor(0xFF0000);
        if (thumbnail) errEmbed.setThumbnail(thumbnail);
        await interaction.editReply({ embeds: [errEmbed], ephemeral: true });
        return;
    }

    // If the bet is in stars and the house has no stars to pay out, block the gamble early
    if (betType === 'stars' && gambleState && typeof gambleState.starsPool === 'number' && gambleState.starsPool <= 0) {
        const noHouse = new EmbedBuilder().setTitle('House Broke').setDescription('The house has no stars to pay out right now; gambling with stars is temporarily disabled.').setColor(0xFF0000);
        if (thumbnail) noHouse.setThumbnail(thumbnail);
        await interaction.editReply({ embeds: [noHouse], ephemeral: true });
        return;
    }

    // DO NOT deduct the bet up front. Record player's starting inventory for display and change calculations.
    const startInventory = available;

    const sessionId = randomUUID();
    const session = { id: sessionId, userId: interaction.user.id, guildId: interaction.guildId, game, bet: betAmount, betType, refundOnTimeout: false, startInventory };
    sessions.set(sessionId, session);
    session.timeout = makeTimeout(sessionId);

    // create initial embed and components depending on game
    if (game === 'card') {
        const winning = _randInt(3) + 1;
        const isGold = (_randInt(50) === 0);
        session.state = { winning, isGold };

        const embed1 = new EmbedBuilder().setTitle('Card Shuffle').setDescription('A mysterious card appears...').setColor(embedColor);
        if (thumbnail) embed1.setThumbnail(thumbnail);
        // warn if potential payout exceeds house pool
        const potential = isGold ? Math.floor(betAmount * 25) : Math.floor(betAmount * 2.5);
        if (gambleState && typeof gambleState.starsPool === 'number' && potential > gambleState.starsPool) {
            embed1.setDescription(embed1.data.description + `\n\nNote: The house has only ${gambleState.starsPool} stars; maximum payout for this game is ${gambleState.starsPool} stars. If multiple players finish at once, the first to complete receives the payout.`);
        }

        const assetsDir = path.join(__dirname, '..', 'assets', 'cards');
        let files = [];
        const initialPath = findImage(assetsDir, `watch_${winning}`);
        if (initialPath) files.push({ attachment: initialPath, name: path.basename(initialPath) });

        const msg = await interaction.editReply({ embeds: [embed1], files, components: [] });
        session.message = msg;

        setTimeout(async () => {
            try {
                const embed2 = new EmbedBuilder().setTitle('Shuffling...').setDescription('The cards shuffle furiously!').setColor(embedColor);
                if (thumbnail) embed2.setThumbnail(thumbnail);
                const gifPath = path.join(assetsDir, 'shuffle.gif');
                // try several possible shuffle asset extensions
                const candidates = [gifPath, path.join(assetsDir, 'shuffle.mp4'), path.join(assetsDir, 'shuffle.webm'), path.join(assetsDir, 'shuffle.png'), path.join(assetsDir, 'shuffle.jpg')];
                let files2 = [];
                for (const c of candidates) {
                    if (fileExists(c)) {
                        files2 = [{ attachment: c, name: path.basename(c) }];
                        break;
                    }
                }
                try {
                    if (files2.length > 0) await msg.edit({ embeds: [embed2], files: files2, components: [] });
                    else await msg.edit({ embeds: [embed2], components: [] });
                } catch (editErr) {
                    console.error('Error editing message for shuffle animation:', editErr);
                    // fallback: edit without files
                    try { await msg.edit({ embeds: [embed2], components: [] }); } catch (e) { console.error('Fallback edit failed', e); }
                }
            } catch (e) { }
        }, 1000);

        // leave the GIF playing longer so users can enjoy it
        setTimeout(async () => {
            try {
                // randomize final winning slot so it doesn't stay in its original position
                const initial = session.state && session.state.winning ? session.state.winning : null;
                let finalWin = _randInt(3) + 1;
                if (initial !== null) {
                    // attempt to pick a different final slot to ensure shuffling moves it
                    let attempts = 0;
                    while (finalWin === initial && attempts < 5) { finalWin = _randInt(3) + 1; attempts++; }
                }
                session.state.winning = finalWin;

                const embed3 = new EmbedBuilder().setTitle('Pick a Card').setDescription('Choose slot 1, 2, or 3.').setColor(embedColor);
                if (thumbnail) embed3.setThumbnail(thumbnail);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`gamble:${sessionId}:card_pick:1`).setLabel('1').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`gamble:${sessionId}:card_pick:2`).setLabel('2').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`gamble:${sessionId}:card_pick:3`).setLabel('3').setStyle(ButtonStyle.Primary)
                );
                const pickPath = findImage(assetsDir, 'pick');
                const pickFiles = pickPath ? [{ attachment: pickPath, name: path.basename(pickPath) }] : [];
                await msg.edit({ embeds: [embed3], files: pickFiles, components: [row] });
            } catch (e) { }
        }, 5000);

        return;
    }

    if (game === 'blackjack') {
        const deck = buildDeck();
        shuffle(deck);
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];
        session.state = { deck, playerHand, dealerHand, finished: false };

        // Warn if potential payout exceeds house pool
        const potentialBJ = Math.floor(betAmount * 2);
        let desc = renderBlackjack(session.state);
        if (gambleState && typeof gambleState.starsPool === 'number' && potentialBJ > gambleState.starsPool) {
            desc += `\n\nNote: The house has only ${gambleState.starsPool} stars; maximum payout is ${gambleState.starsPool} stars. If multiple players finish at once, the first to complete receives the payout.`;
        }
        const embed = new EmbedBuilder().setTitle('Blackjack').setDescription(desc).setColor(embedColor);
        if (thumbnail) embed.setThumbnail(thumbnail);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`gamble:${sessionId}:bj_hit`).setLabel('Hit').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`gamble:${sessionId}:bj_stand`).setLabel('Stand').setStyle(ButtonStyle.Secondary)
        );

        const msg = await interaction.editReply({ embeds: [embed], components: [row] });
        session.message = msg;
        return;
    }

    if (game === 'rps') {
        const totalLeft = (gambleState.rocks || 0) + (gambleState.papers || 0) + (gambleState.scissors || 0) + (gambleState.elderHand || 0);
        session.state = { botCounts: gambleState, playerChoice: null };
        const potentialRPS = Math.floor(betAmount * 2);
        let rpsDesc = `Bigfoot flips through his deck. It has **${totalLeft}** cards left in it.`;
        if (gambleState && typeof gambleState.starsPool === 'number' && potentialRPS > gambleState.starsPool) {
            rpsDesc += `\n\nNote: The house has only ${gambleState.starsPool} stars; maximum payout is ${gambleState.starsPool} stars.`;
        }
        const embed = new EmbedBuilder().setTitle('Rock Paper Scissors').setDescription(rpsDesc).setColor(embedColor);
        if (thumbnail) embed.setThumbnail(thumbnail);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`gamble:${sessionId}:rps_rock`).setLabel('Rock').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`gamble:${sessionId}:rps_paper`).setLabel('Paper').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`gamble:${sessionId}:rps_scissors`).setLabel('Scissors').setStyle(ButtonStyle.Primary)
        );
        const msg = await interaction.editReply({ embeds: [embed], components: [row] });
        session.message = msg;
        return;
    }

    const errEmbed = new EmbedBuilder().setTitle('Unknown Game').setDescription('Unknown game type.').setColor(0xFF0000);
    if (thumbnail) errEmbed.setThumbnail(thumbnail);
    await interaction.editReply({ embeds: [errEmbed], ephemeral: true });
}

function buildDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const deck = [];
    for (const s of suits) for (const r of ranks) deck.push({ s, r });
    return deck;
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function handValue(hand) {
    let total = 0; let aces = 0;
    for (const c of hand) {
        if (['J','Q','K'].includes(c.r)) total += 10;
        else if (c.r === 'A') { aces++; total += 11; }
        else total += parseInt(c.r, 10);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function renderBlackjack(state) {
    const pVal = handValue(state.playerHand);
    const dVal = handValue(state.dealerHand);
    const pStr = state.playerHand.map(c => `${c.r}${c.s}`).join(' ');
    const dStr = state.dealerHand.map(c => `${c.r}${c.s}`).join(' ');
    return `Your hand: ${pStr} (${pVal})\nDealer hand: ${dStr} (${dVal})`;
}

async function handleButtonInteraction(customId, interaction) {
    // format: gamble:sessionId:action[:arg]
    const parts = (customId || '').split(':');
    if (parts.length < 3) return false;
    const sessionId = parts[1];
    const action = parts[2];
    const arg = parts[3];

    const session = sessions.get(sessionId);
    if (!session) {
        try {
            const err = new EmbedBuilder().setTitle('Session Not Found').setDescription('This gamble session has expired or does not exist.').setColor(0xFF0000);
            await interaction.reply({ embeds: [err], ephemeral: true });
        } catch (e) {}
        return true;
    }

    if (String(session.userId) !== String(interaction.user.id)) {
        try {
            const err = new EmbedBuilder().setTitle('Not Your Game').setDescription('This interaction is not for you. To play, use /gamble.').setColor(0xFF0000);
            await interaction.reply({ embeds: [err], ephemeral: true });
        } catch (e) {}
        return true;
    }

    if (session.timeout) { clearTimeout(session.timeout); session.timeout = null; }

    try {
        const db = await connectToMongo();
        const discordConfig = await getDiscordConfig(db, session.guildId);
        const embedColor = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff;
        const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;

        if (action === 'card_pick') {
            const pick = parseInt(arg || '0', 10);
            const { winning, isGold } = session.state || {};
            const campers = db.collection('campers');
            const gamblingCol = db.collection('gambling_state');
            const player = await campers.findOne({ discordId: session.userId });

            const won = (pick === winning);
            let payout = 0;
            if (won) {
                const desired = isGold ? Math.floor(session.bet * 25) : Math.floor(session.bet * 2.5);
                const stateDoc = await gamblingCol.findOne({ _id: 'global' });
                const pool = (stateDoc && typeof stateDoc.starsPool === 'number') ? stateDoc.starsPool : 0;
                const actualPaid = Math.min(desired, Math.max(0, pool));
                if (actualPaid > 0) {
                    payout = actualPaid;
                    await applyPlayerInc(campers, { _id: player._id }, { ['inventory.' + session.betType]: payout }, 'card_payout');
                    await applyGambleInc(db, { starsPool: -actualPaid, 'stats.cardWins': 1, 'stats.totalPayouts': actualPaid, 'stats.totalBets': session.bet }, 'card_win');
                } else {
                    payout = 0;
                    // record that bet was played
                    await applyGambleInc(db, { 'stats.cardWins': 1, 'stats.totalPayouts': 0, 'stats.totalBets': session.bet }, 'card_win_no_pool');
                }
            } else {
                // player loses: remove bet from player's inventory and add to house
                await applyPlayerInc(campers, { _id: player._id }, { ['inventory.' + session.betType]: -session.bet }, 'card_loss_player_deduct');
                await applyGambleInc(db, { starsPool: session.bet, 'stats.cardLosses': 1, 'stats.totalBets': session.bet }, 'card_loss');
            }

            // fetch updated player inventory so we can show remaining balance
            const updatedPlayer = await campers.findOne({ _id: player._id });
            const remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;

            // compute actual change since the bet was deducted
            const startInv = (session && typeof session.startInventory === 'number') ? session.startInventory : 0;
            const actualChange = remaining - startInv;

            const assetsDir = path.join(__dirname, '..', 'assets', 'cards');
            const revealBase = isGold ? `gold_${winning}` : `reveal_${winning}`;
            const revealPath = findImage(assetsDir, revealBase);
            const embed = new EmbedBuilder().setTitle('Card Result').setColor(won ? 0x00FF00 : 0xFF0000);
            if (thumbnail) embed.setThumbnail(thumbnail);
            embed.setDescription(won ? `You picked ${pick} — You won ${actualChange} ${session.betType}!` : `You picked ${pick}, but the jester evades you. Better luck next time.`);
            // include winnings and remaining in embed fields
            if (won) {
                embed.addFields(
                    { name: 'Winnings', value: `+${actualChange} ${session.betType}`, inline: true },
                    { name: 'Inventory', value: `${remaining} ${session.betType}`, inline: true }
                );
            } else {
                embed.addFields(
                    { name: 'Winnings', value: `0 ${session.betType}`, inline: true },
                    { name: 'Inventory', value: `${remaining} ${session.betType}`, inline: true }
                );
            }
            try { await session.message.edit({ embeds: [embed], files: revealPath ? [{ attachment: revealPath, name: path.basename(revealPath) }] : [], components: [] }); } catch (e) {}

            sessions.delete(sessionId);
            await interaction.reply({ content: won ? `You won ${actualChange} ${session.betType}! You now have ${remaining} ${session.betType}.` : `You lost ${session.bet} ${session.betType}. You now have ${remaining} ${session.betType}.`, ephemeral: true });
            return true;
        }

        if (action === 'bj_hit' || action === 'bj_stand') {
            const campers = db.collection('campers');
            const player = await campers.findOne({ discordId: session.userId });
            const state = session.state;
            if (!state || state.finished) {
                await interaction.reply({ content: 'This game is already finished.', ephemeral: true });
                return true;
            }

            if (action === 'bj_hit') {
                state.playerHand.push(state.deck.pop());
                    if (handValue(state.playerHand) > 21) {
                    state.finished = true;
                        // deduct player's bet on bust and add to house
                        await applyPlayerInc(campers, { _id: player._id }, { ['inventory.' + session.betType]: -session.bet }, 'bj_bust_player_deduct');
                        await applyGambleInc(db, { starsPool: session.bet, 'stats.bjLosses': 1, 'stats.totalBets': session.bet }, 'bj_bust');
                    const embed = new EmbedBuilder().setTitle('Blackjack — Busted').setDescription(renderBlackjack(state)).setColor(0xFF0000);
                    if (thumbnail) embed.setThumbnail(thumbnail);
                    // fetch updated player inventory
                    const updatedPlayer = await campers.findOne({ _id: player._id });
                    const remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
                    embed.addFields(
                        { name: 'Winnings', value: `0 ${session.betType}`, inline: true },
                        { name: 'Inventory', value: `${remaining} ${session.betType}`, inline: true }
                    );
                    try { await session.message.edit({ embeds: [embed], components: [] }); } catch (e) {}
                    sessions.delete(session.id);
                    await interaction.reply({ content: `You busted and lost ${session.bet} ${session.betType}. You now have ${remaining} ${session.betType}.`, ephemeral: true });
                    return true;
                }
            } else if (action === 'bj_stand') {
                while (handValue(state.dealerHand) < 17) state.dealerHand.push(state.deck.pop());
                state.finished = true;
                const pVal = handValue(state.playerHand);
                const dVal = handValue(state.dealerHand);
                let result = 'lose';
                if (pVal > 21) result = 'lose';
                else if (dVal > 21) result = 'win';
                else if (pVal > dVal) result = 'win';
                else if (pVal === dVal) result = 'push';
                else result = 'lose';

                const gambleCol = db.collection('gambling_state');
                if (result === 'win') {
                    const desired = Math.floor(session.bet * 2);
                    const stateDoc = await gambleCol.findOne({ _id: 'global' });
                    const pool = (stateDoc && typeof stateDoc.starsPool === 'number') ? stateDoc.starsPool : 0;
                    const actualPaid = Math.min(desired, Math.max(0, pool));
                    if (actualPaid > 0) {
                        await applyPlayerInc(campers, { _id: player._id }, { ['inventory.' + session.betType]: actualPaid }, 'bj_payout');
                        await applyGambleInc(db, { starsPool: -actualPaid, 'stats.bjWins': 1, 'stats.totalPayouts': actualPaid, 'stats.totalBets': session.bet }, 'bj_win');
                    } else {
                        await applyGambleInc(db, { 'stats.bjWins': 1, 'stats.totalPayouts': 0, 'stats.totalBets': session.bet }, 'bj_win_no_pool');
                    }
                    const updatedPlayer = await campers.findOne({ _id: player._id });
                    const remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
                    const startInv = (session && typeof session.startInventory === 'number') ? session.startInventory : 0;
                    const actualChange = remaining - startInv;
                    const embed = new EmbedBuilder().setTitle('Blackjack — You Win').setDescription(renderBlackjack(state) + `\nYou win ${actualChange} ${session.betType}`).setColor(0x00FF00);
                    if (thumbnail) embed.setThumbnail(thumbnail);
                    embed.addFields({ name: 'Winnings', value: `+${actualChange} ${session.betType}`, inline: true }, { name: 'Inventory', value: `${remaining} ${session.betType}`, inline: true });
                    try { await session.message.edit({ embeds: [embed], components: [] }); } catch (e) {}
                    await interaction.reply({ content: `You win ${actualChange} ${session.betType}! You now have ${remaining} ${session.betType}.`, ephemeral: true });
                } else if (result === 'push') {
                    // push: no inventory change because bet wasn't deducted upfront; just record the bet
                    await applyGambleInc(db, { 'stats.totalBets': session.bet }, 'bj_push');
                    const updatedPlayer = await campers.findOne({ _id: player._id });
                    const remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
                    const startInv = (session && typeof session.startInventory === 'number') ? session.startInventory : 0;
                    const actualChange = remaining - startInv;
                    const embed = new EmbedBuilder().setTitle('Blackjack — Push').setDescription(renderBlackjack(state) + `\nPush. Your bet is returned.`).setColor(0xFFFF00);
                    if (thumbnail) embed.setThumbnail(thumbnail);
                    embed.addFields({ name: 'Winnings', value: `+${actualChange} ${session.betType}`, inline: true }, { name: 'Inventory', value: `${remaining} ${session.betType}`, inline: true });
                    try { await session.message.edit({ embeds: [embed], components: [] }); } catch (e) {}
                    await interaction.reply({ content: `Push — your bet was returned. You now have ${remaining} ${session.betType}.`, ephemeral: true });
                } else {
                    // player loses: deduct bet and add to house pool
                    await applyPlayerInc(campers, { _id: player._id }, { ['inventory.' + session.betType]: -session.bet }, 'bj_loss_player_deduct');
                    await applyGambleInc(db, { starsPool: session.bet, 'stats.bjLosses': 1, 'stats.totalBets': session.bet }, 'bj_loss');
                    const updatedPlayer = await campers.findOne({ _id: player._id });
                    const remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
                    const embed = new EmbedBuilder().setTitle('Blackjack — You Lose').setDescription(renderBlackjack(state)).setColor(0xFF0000);
                    if (thumbnail) embed.setThumbnail(thumbnail);
                    embed.addFields({ name: 'Winnings', value: `0 ${session.betType}`, inline: true }, { name: 'Inventory', value: `${remaining} ${session.betType}`, inline: true });
                    try { await session.message.edit({ embeds: [embed], components: [] }); } catch (e) {}
                    await interaction.reply({ content: `You lost ${session.bet} ${session.betType}. You now have ${remaining} ${session.betType}.`, ephemeral: true });
                }

                sessions.delete(session.id);
                return true;
            }

            try { const embed = new EmbedBuilder().setTitle('Blackjack').setDescription(renderBlackjack(state)).setColor(embedColor); if (thumbnail) embed.setThumbnail(thumbnail); await session.message.edit({ embeds: [embed] }); } catch (e) {}
            await interaction.reply({ content: 'Card drawn.', ephemeral: true });
            return true;
        }

        if (action.startsWith('rps_')) {
            const choice = action.split('_')[1]; // rock/paper/scissors
            const campers = db.collection('campers');

            // ensure player has the R/P/S item before allowing play
            const playerDoc = await campers.findOne({ discordId: session.userId });
            if (!playerDoc) {
                const em = new EmbedBuilder().setTitle('No Profile').setDescription('Could not find your player record.').setColor(embedColor);
                if (thumbnail) em.setThumbnail(thumbnail);
                try { await interaction.reply({ embeds: [em], ephemeral: true }); } catch (e) {}
                sessions.delete(session.id);
                return true;
            }
            const fieldMap = { rock: 'rpsRock', paper: 'rpsPaper', scissors: 'rpsScissors' };
            const playerField = fieldMap[choice];
            if (!playerField) {
                const em = new EmbedBuilder().setTitle('Invalid Choice').setDescription('Invalid choice.').setColor(embedColor);
                if (thumbnail) em.setThumbnail(thumbnail);
                try { await interaction.reply({ embeds: [em], ephemeral: true }); } catch (e) {}
                return true;
            }
            const playerCount = (playerDoc.inventory && typeof playerDoc.inventory[playerField] === 'number') ? playerDoc.inventory[playerField] : 0;
            if (playerCount <= 0) {
                const em = new EmbedBuilder().setTitle('No Cards Left').setDescription(`You don't have any ${choice} cards left. They refresh daily.`).setColor(embedColor);
                if (thumbnail) em.setThumbnail(thumbnail);
                try { await interaction.reply({ embeds: [em], ephemeral: true }); } catch (e) {}
                return true;
            }
            // consume the player's R/P/S card
            await applyPlayerInc(campers, { _id: playerDoc._id }, { ['inventory.' + playerField]: -1 }, 'rps_consume_card');
            const gambleCol = db.collection('gambling_state');
            let stateDoc = await gambleCol.findOne({ _id: 'global' });
            if (!stateDoc) stateDoc = { rocks:10,papers:10,scissors:10,elderHand:1, starsPool:10 };

            const botOptions = [];
            if ((stateDoc.rocks || 0) > 0) botOptions.push('rock');
            if ((stateDoc.papers || 0) > 0) botOptions.push('paper');
            if ((stateDoc.scissors || 0) > 0) botOptions.push('scissors');
            if (botOptions.length === 0 && (stateDoc.elderHand || 0) > 0) botOptions.push('elder');
            let botChoice = botOptions[_randInt(botOptions.length)];

            const beat = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
            let result = 'draw';
            if (botChoice === choice) result = 'draw';
            else if (beat[choice] === botChoice) result = 'win';
            else if (botChoice === 'elder') {
                // elder beats everything
                result = 'lose';
            } else result = 'lose';

            const potentialPayout = Math.floor(session.bet * 2);
            let actualPaid = 0;
            // decrement bot choice counts if not elder
            if (botChoice !== 'elder') {
                const incObj = {};
                if (botChoice === 'rock') incObj.rocks = -1;
                if (botChoice === 'paper') incObj.papers = -1;
                if (botChoice === 'scissors') incObj.scissors = -1;
                if (Object.keys(incObj).length > 0) await applyGambleInc(db, incObj, `rps_dec_${botChoice}`);
            }


            if (result === 'win') {
                const desired = potentialPayout;
                const stateDoc = await gambleCol.findOne({ _id: 'global' });
                const pool = (stateDoc && typeof stateDoc.starsPool === 'number') ? stateDoc.starsPool : 0;
                actualPaid = Math.min(desired, Math.max(0, pool));
                if (actualPaid > 0) {
                    await applyPlayerInc(campers, { discordId: session.userId }, { ['inventory.' + session.betType]: actualPaid }, 'rps_payout');
                    await applyGambleInc(db, { starsPool: -actualPaid, 'stats.rpsWins': 1, 'stats.totalPayouts': actualPaid, 'stats.totalBets': session.bet }, 'rps_win');
                } else {
                    await applyGambleInc(db, { 'stats.rpsWins': 1, 'stats.totalPayouts': 0, 'stats.totalBets': session.bet }, 'rps_win_no_pool');
                }
                // fetch updated player inventory
                var updatedPlayer = await campers.findOne({ discordId: session.userId });
                var remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
            } else if (result === 'draw') {
                // draw: bet is not deducted up front, so no refund; just record the bet
                await applyGambleInc(db, { 'stats.totalBets': session.bet }, 'rps_draw');
                var updatedPlayer = await campers.findOne({ discordId: session.userId });
                var remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
            } else if (result === 'lose') {
                // player loses: deduct bet and add to pool
                await applyPlayerInc(campers, { discordId: session.userId }, { ['inventory.' + session.betType]: -session.bet }, 'rps_loss_player_deduct');
                await applyGambleInc(db, { starsPool: session.bet, 'stats.rpsLosses': 1, 'stats.totalBets': session.bet }, 'rps_loss');
                var updatedPlayer = await campers.findOne({ discordId: session.userId });
                var remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
            }

            const assetsDir = path.join(__dirname, '..', 'assets', 'cards');
            const playerImg = findImage(assetsDir, `${choice}`);
            let botImg = null;
            if (botChoice === 'elder') {
                botImg = findImage(assetsDir, 'hand of the elder beast') || findImage(assetsDir, 'elder');
            } else {
                botImg = findImage(assetsDir, `${botChoice}`);
            }

            // human-friendly result text
            const displayChoice = choice.charAt(0).toUpperCase() + choice.slice(1);
            const displayBot = (botChoice === 'elder') ? 'Hand of the Elder Beast' : (botChoice ? (botChoice.charAt(0).toUpperCase() + botChoice.slice(1)) : 'Unknown');
            const humanResult = result === 'win' ? 'You won!' : result === 'lose' ? 'You lost.' : "It's a draw.";
            const embed = new EmbedBuilder().setTitle('Rock Paper Scissors').setDescription(`You chose **${displayChoice}**. Bigfoot chose **${displayBot}**. ${humanResult}`).setColor(result === 'win' ? 0x00FF00 : result === 'lose' ? 0xFF0000 : 0xFFFF00);
            if (thumbnail) embed.setThumbnail(thumbnail);
            // ensure we have the player's current inventory for display (covers draw case too)
            if (typeof updatedPlayer === 'undefined') {
                updatedPlayer = await campers.findOne({ discordId: session.userId });
                remaining = (updatedPlayer && updatedPlayer.inventory && typeof updatedPlayer.inventory[session.betType] === 'number') ? updatedPlayer.inventory[session.betType] : 0;
            }
            const startInv = (session && typeof session.startInventory === 'number') ? session.startInventory : 0;
            const actualChange = remaining - startInv;
            embed.addFields({ name: 'Winnings', value: result === 'win' ? `+${actualChange || 0} ${session.betType}` : `0 ${session.betType}`, inline: true }, { name: 'Inventory', value: `${remaining} ${session.betType}`, inline: true });
            try { await session.message.edit({ embeds: [embed], components: [], files: [ ...(playerImg ? [{ attachment: playerImg, name: path.basename(playerImg) }] : []), ...(botImg ? [{ attachment: botImg, name: path.basename(botImg) }] : []) ] }); } catch (e) {}
            sessions.delete(session.id);
            await interaction.reply({ content: `${humanResult} You now have ${remaining || 0} ${session.betType}.`, ephemeral: true });
            return true;
        }
    } catch (err) {
        console.error('handleButtonInteraction error', err);
        try {
            const errEmbed = new EmbedBuilder().setTitle('Error').setDescription('There was an error processing your gamble.').setColor(0xFF0000);
            await interaction.reply({ embeds: [errEmbed], ephemeral: true });
        } catch (e) {}
        sessions.delete(sessionId);
        return true;
    }

    return false;
}

module.exports = { startGamble, handleButtonInteraction };
