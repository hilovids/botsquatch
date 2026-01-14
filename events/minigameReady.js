const { Events, EmbedBuilder, Client } = require('discord.js');
const { connectToMongo } = require('../utils/mongodbUtil');
const fs = require('fs');
const path = require('path');
const { pickRandomChallenge } = require('../utils/minigameBank');
const { startDailyNotifier, startDailyCamperRefresh } = require('../utils/houseManager');

// give players 1 minute to respond (in ms)
const RESPONSE_TIME_MS = 1 * 60 * 1000;

function answerMatches(challenge, content) {
    if (!content) return false;
    const lc = content.toLowerCase();
    const answers = challenge.answers || {};
    if (answers.type === 'emoji') {
        return answers.correct.some(ans => content.includes(ans));
    }
    // text matching (contains, case-insensitive)
    return answers.correct.some(ans => lc.includes(String(ans).toLowerCase()));
}

async function postChallengeToGuild(guild) {
    if (!guild) return;

    const db = await connectToMongo();
    const discordConfigs = db.collection('discordConfigs');
    const discordConfig = await discordConfigs.findOne({ server_id: guild.id }).catch(() => null);

    // try configured campground channel id first (if config exists), otherwise fall back to campground name/system/first writable
    let channel = null;
    if (discordConfig && discordConfig.campground_id) {
        try {
            channel = await guild.channels.fetch(String(discordConfig.campground_id));
        } catch (e) { channel = null; }
    }

    // fallback: prefer a channel named 'campground'
    if (!channel) {
        channel = guild.channels.cache.find(c => c.name && c.name.toLowerCase() === 'campground' && typeof c.send === 'function' && c.permissionsFor(guild.members.me) && c.permissionsFor(guild.members.me).has('SendMessages')) || null;
    }

    // fallback: system channel
    if (!channel && guild.systemChannel && typeof guild.systemChannel.send === 'function' && guild.systemChannel.permissionsFor(guild.members.me) && guild.systemChannel.permissionsFor(guild.members.me).has('SendMessages')) {
        channel = guild.systemChannel;
    }

    // final fallback: first writable channel
    if (!channel) {
        channel = guild.channels.cache.find(c => typeof c.send === 'function' && c.permissionsFor(guild.members.me) && c.permissionsFor(guild.members.me).has('SendMessages')) || null;
    }

    if (!channel) return;

    const challenge = await pickRandomChallenge();
    if (!challenge) return;

    const color = (discordConfig && discordConfig.embed && discordConfig.embed.color) ? discordConfig.embed.color : 0xFFD700;

    const embed = new EmbedBuilder()
        .setTitle(`🎯 Camp Hilo Mini Challenge - ${challenge.answers && challenge.answers.type === 'emoji' ? 'Emoji' : 'Text'} Response!`)
        .setDescription(challenge.prompt && challenge.prompt.text ? challenge.prompt.text : 'Be the first to respond!')
        .setColor(color)
        .setFooter({ text: `Respond within ${Math.floor(RESPONSE_TIME_MS / 1000)} seconds to win!` });

    // support local glyph assets placed in assets/glyphs
    const files = [];
    let sentEmbed = embed;
    // check several possible properties for an asset filename
    const candidate = (challenge && challenge.prompt && (challenge.prompt.imageAsset || challenge.prompt.imageFile)) || challenge.imageAsset || challenge.imageFile || null;
    const preImageLine = 'An ancient tablet was found in the crystal caverns carved with this glyph...';
    if (candidate && typeof candidate === 'string') {
        const filename = path.basename(candidate);
        const assetPath = path.join(__dirname, '..', 'assets', 'glyphs', filename);
        try {
            if (fs.existsSync(assetPath)) {
                // add pre-image descriptive line to the embed description
                try { sentEmbed = embed.setDescription((challenge.prompt && challenge.prompt.text ? challenge.prompt.text + '\n\n' : '') + preImageLine); } catch (e) {}
                files.push({ attachment: assetPath, name: filename });
                sentEmbed = embed.setImage(`attachment://${filename}`);
            } else if (challenge.prompt && challenge.prompt.imageUrl) {
                try { sentEmbed = embed.setDescription((challenge.prompt && challenge.prompt.text ? challenge.prompt.text + '\n\n' : '') + preImageLine); } catch (e) {}
                sentEmbed = embed.setImage(challenge.prompt.imageUrl);
            }
        } catch (e) {
            if (challenge.prompt && challenge.prompt.imageUrl) {
                try { sentEmbed = embed.setDescription((challenge.prompt && challenge.prompt.text ? challenge.prompt.text + '\n\n' : '') + preImageLine); } catch (e) {}
                sentEmbed = embed.setImage(challenge.prompt.imageUrl);
            }
        }
    } else if (challenge.prompt && challenge.prompt.imageUrl) {
        try { sentEmbed = embed.setDescription((challenge.prompt && challenge.prompt.text ? challenge.prompt.text + '\n\n' : '') + preImageLine); } catch (e) {}
        sentEmbed = embed.setImage(challenge.prompt.imageUrl);
    }

    const botMsg = await channel.send({ embeds: [sentEmbed], files: files.length ? files : undefined }).catch(() => null);
    if (!botMsg) return;

    // record that a challenge was posted for stats
    try {
        const statsCol = db.collection('minigame_stats');
        const incPosted = { posted: 1 };
        incPosted[`byChallenge.${challenge.id}.posted`] = 1;
        await statsCol.updateOne({ guildId: String(guild.id) }, { $inc: incPosted }, { upsert: true });
    } catch (e) { console.error('minigame stats post error', e); }

    const filter = (m) => { if (m.author.bot) return false; return answerMatches(challenge, m.content || ''); };
    const collector = channel.createMessageCollector({ filter, time: RESPONSE_TIME_MS });
    let winnerFound = false;

    // return a promise that resolves when this challenge's collector ends
    return new Promise((resolve) => {
        collector.on('collect', async (m) => {
            try {
                const campersCol = db.collection('campers');

                // only award / end if this author has a camper record
                const camper = await campersCol.findOne({ discordId: String(m.author.id) });
                if (!camper) return; // ignore unregistered users

                const reward = challenge.reward || { type: 'stars', amount: 1 };
                const inc = {};
                if (reward.type === 'stars') inc['inventory.stars'] = reward.amount || 1;
                if (reward.type === 'coins') inc['inventory.coins'] = reward.amount || 0;

                // update existing camper (do not create new)
                await campersCol.updateOne({ discordId: String(m.author.id) }, { $inc: inc }, { upsert: false });

                const updated = await campersCol.findOne({ discordId: String(m.author.id) });
                const totalStars = (updated && updated.inventory && updated.inventory.stars) || 0;
                const totalCoins = (updated && updated.inventory && updated.inventory.coins) || 0;

                // update stats: successes and response time
                try {
                    const statsCol = db.collection('minigame_stats');
                    const responseMs = (m.createdTimestamp || Date.now()) - (botMsg.createdTimestamp || Date.now());
                    const inc = { successes: 1, responseCount: 1, totalResponseMs: responseMs };
                    inc[`byChallenge.${challenge.id}.successes`] = 1;
                    inc[`byChallenge.${challenge.id}.totalResponseMs`] = responseMs;
                    await statsCol.updateOne({ guildId: String(guild.id) }, { $inc: inc }, { upsert: true });
                } catch (e) { console.error('minigame stats success error', e); }

                const emoji = reward.type === 'coins' ? '💰' : '⭐';

                const winEmbed = new EmbedBuilder()
                    .setTitle('🏆 Challenge Won!')
                    .setDescription(`${m.author} ${challenge.feedback && challenge.feedback.onWin ? challenge.feedback.onWin : 'won the challenge!'}`)
                    .setColor(color)
                    .addFields(
                        { name: 'Reward', value: `${reward.amount}x ${emoji}` },
                        reward.type === 'stars' ? { name: 'Total Stars', value: String(totalStars) } : { name: 'Total Coins', value: String(totalCoins) }
                    );

                winnerFound = true;
                try { await botMsg.delete().catch(() => {}); } catch (e) {}
                await channel.send({ embeds: [winEmbed] }).catch(() => { });
                collector.stop('winner');
            } catch (e) {
                console.error('minigame collect error', e);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (!winnerFound) {
                const expiredEmbed = new EmbedBuilder()
                    .setTitle('⏱️ Challenge Expired')
                    .setDescription(challenge.feedback && challenge.feedback.onExpire ? challenge.feedback.onExpire : 'No one answered in time.')
                    .setColor(0x808080);
                try { await botMsg.delete().catch(() => {}); } catch (e) {}
                await channel.send({ embeds: [expiredEmbed] }).catch(() => { });
                await channel.send(`No winners this time — ${challenge.feedback && challenge.feedback.onExpire ? challenge.feedback.onExpire : 'expired.'}`).catch(() => { });

                // update stats: failure
                try {
                    const statsCol = db.collection('minigame_stats');
                    const inc = { failures: 1 };
                    inc[`byChallenge.${challenge.id}.failures`] = 1;
                    await statsCol.updateOne({ guildId: String(guild.id) }, { $inc: inc }, { upsert: true });
                } catch (e) { console.error('minigame stats failure error', e); }
            }
            resolve();
        });
    });
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        try {
            const db = await connectToMongo();

            // continuous scheduler: post one batch, wait for all to finish, then wait 1-3 hours and repeat
            async function continuousScheduler() {
                const minMs = 1 * 60 * 60 * 1000; // 1 hour
                const maxMs = 3 * 60 * 60 * 1000; // 3 hours
                while (true) {
                    const promises = [];
                    for (const guild of client.guilds.cache.values()) {
                        try {
                            const p = postChallengeToGuild(guild);
                            if (p && typeof p.then === 'function') promises.push(p);
                        } catch (e) { console.error('posting challenge error', e); }
                    }

                    try { await Promise.all(promises); } catch (e) { console.error('error waiting for challenges to finish', e); }

                    const delay = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            // continuousScheduler();

            // start daily house notifier
            try { startDailyNotifier(client); } catch (e) { console.error('startDailyNotifier error', e); }
            try { startDailyCamperRefresh(); } catch (e) { console.error('startDailyCamperRefresh error', e); }
            console.log('Minigame scheduler started (and immediate drop posted)');
        } catch (e) {
            console.error('minigame ready error', e);
        }
    }
};
