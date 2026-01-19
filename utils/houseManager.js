const { connectToMongo } = require('./mongodbUtil');
const cron = require('node-cron');

const DEFAULTS = {
    houseStars: 30,
    rpsDefaults: { rocks: 10, papers: 10, scissors: 10, elderHand: 1 }
};

async function getResources() {
    const db = await connectToMongo();
    const col = db.collection('gambling_state');
    const doc = await col.findOne({ _id: 'global' });
    if (!doc) return null;
    return {
        payouts: doc.payouts || { card: { multiplier: 2.5 }, blackjack: { multiplier: 2.0 }, rps: { multiplier: 2.0 } },
        counts: { rocks: doc.rocks || 0, papers: doc.papers || 0, scissors: doc.scissors || 0, elderHand: doc.elderHand || 0 },
        starsPool: doc.starsPool || 0,
        stats: doc.stats || {},
        lastMaintenanceAt: doc.lastMaintenanceAt || null
    };
}

// Ensure each camper has at least one R/P/S
async function performCamperGrant() {
    try {
        const db = await connectToMongo();
        const campers = db.collection('campers');
        await campers.updateMany({}, { $max: { 'inventory.rpsRock': 1, 'inventory.rpsPaper': 1, 'inventory.rpsScissors': 1 } });
        return { ok: true };
    } catch (e) { console.error('performCamperGrant error', e); return { ok: false, error: String(e) }; }
}

// Refill the house RPSH cards to defaults
async function performWeeklyRpsRefill() {
    try {
        const db = await connectToMongo();
        const col = db.collection('gambling_state');
        const now = new Date();
        const set = { ...DEFAULTS.rpsDefaults, lastRpsRefillAt: now };
        await col.updateOne({ _id: 'global' }, { $set: set }, { upsert: true });
        return { ok: true, set };
    } catch (e) { console.error('performWeeklyRpsRefill error', e); return { ok: false, error: String(e) }; }
}

// Refill the house star pool to default value
async function performHouseStarRefill() {
    try {
        const db = await connectToMongo();
        const col = db.collection('gambling_state');
        const now = new Date();
        await col.updateOne({ _id: 'global' }, { $set: { starsPool: DEFAULTS.houseStars, lastHouseRefillAt: now } }, { upsert: true });
        return { ok: true };
    } catch (e) { console.error('performHouseStarRefill error', e); return { ok: false, error: String(e) }; }
}

// Combined maintenance operation run weekly by the scheduler
async function performWeeklyMaintenance() {
    try {
        // Guard: avoid running more often than every 24 hours
        const now = new Date();
        try {
            const db = await connectToMongo();
            const col = db.collection('gambling_state');
            const state = await col.findOne({ _id: 'global' });
            const last = state && state.lastMaintenanceAt ? new Date(state.lastMaintenanceAt) : new Date(0);
            const minInterval = 24 * 60 * 60 * 1000; // 24 hours
            if (now - last < minInterval) {
                return { ok: false, reason: 'not due' };
            }
        } catch (e) {
            // if we can't read state, proceed with maintenance but log
            console.error('performWeeklyMaintenance: could not read previous maintenance timestamp', e);
        }

        // Redistribute shared starsPool across all campers, reset individual pools to DEFAULTS.houseStars + share
        try {
            const db = await connectToMongo();
            const col = db.collection('gambling_state');
            const campersCol = db.collection('campers');
            const state = await col.findOne({ _id: 'global' });
            const shared = (state && typeof state.starsPool === 'number') ? state.starsPool : 0;
            const totalCampers = await campersCol.countDocuments();
            const num = Math.max(1, totalCampers);
            const extraPer = Math.floor(shared / num);

            // set each camper's gamblePool to base + extraPer
            await campersCol.updateMany({}, { $set: { gamblePool: DEFAULTS.houseStars + extraPer } });

            // leave remainder in shared pool
            const remainder = shared - (extraPer * num);
            await col.updateOne({ _id: 'global' }, { $set: { starsPool: remainder, lastMaintenanceAt: now } }, { upsert: true });

            // also perform house RPS refill and grant R/P/S to campers in parallel
            const [rpsRes, grantRes] = await Promise.allSettled([performWeeklyRpsRefill(), performCamperGrant()]);
            return { ok: true, redistributed: { perCamperExtra: extraPer, remainder }, rps: rpsRes.status === 'fulfilled' ? rpsRes.value : { ok: false, error: String(rpsRes.reason) }, campers: grantRes.status === 'fulfilled' ? grantRes.value : { ok: false, error: String(grantRes.reason) } };
        } catch (e) {
            console.error('performWeeklyMaintenance redistribution error', e);
            return { ok: false, error: String(e) };
        }
    } catch (e) { console.error('performWeeklyMaintenance error', e); return { ok: false, error: String(e) }; }
}

// Post a daily summary embed to each guild (uses discordConfigs and minigame_stats)
async function startDailyNotifier(client) {
    if (!client) return;
    const { EmbedBuilder } = require('discord.js');
    const db = await connectToMongo();
    const col = db.collection('gambling_state');
    const discordConfigs = db.collection('discordConfigs');
    const miniStatsCol = db.collection('minigame_stats');

    function msToHuman(ms) {
        if (ms <= 0) return 'Due now';
        const sec = Math.floor(ms / 1000);
        const days = Math.floor(sec / 86400);
        const hours = Math.floor((sec % 86400) / 3600);
        const minutes = Math.floor((sec % 3600) / 60);
        const parts = [];
        if (days) parts.push(`${days}d`);
        if (hours) parts.push(`${hours}h`);
        if (minutes) parts.push(`${minutes}m`);
        if (parts.length === 0) return '<1m';
        return parts.join(' ');
    }

    async function postOnce() {
        try {
            const doc = await col.findOne({ _id: 'global' });
            if (!doc) return;

            for (const guild of client.guilds.cache.values()) {
                try {
                    const discordConfig = await discordConfigs.findOne({ server_id: guild.id }).catch(() => null);
                    const color = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff;
                    const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;

                    // select channel: configured campground -> 'campground' -> system -> first writable
                    let channel = null;
                    if (discordConfig && discordConfig.campground_id) {
                        try { channel = await guild.channels.fetch(String(discordConfig.campground_id)); } catch (e) { channel = null; }
                    }
                    if (!channel) channel = guild.channels.cache.find(c => c.name && c.name.toLowerCase() === 'campground' && typeof c.send === 'function' && c.permissionsFor(guild.members.me) && c.permissionsFor(guild.members.me).has('SendMessages')) || null;
                    if (!channel && guild.systemChannel && typeof guild.systemChannel.send === 'function' && guild.systemChannel.permissionsFor(guild.members.me) && guild.systemChannel.permissionsFor(guild.members.me).has('SendMessages')) channel = guild.systemChannel;
                    if (!channel) channel = guild.channels.cache.find(c => typeof c.send === 'function' && c.permissionsFor(guild.members.me) && c.permissionsFor(guild.members.me).has('SendMessages')) || null;
                    if (!channel) continue;

                    const rocks = (doc && doc.rocks) || DEFAULTS.rpsDefaults.rocks;
                    const papers = (doc && doc.papers) || DEFAULTS.rpsDefaults.papers;
                    const scissors = (doc && doc.scissors) || DEFAULTS.rpsDefaults.scissors;
                    const elder = (doc && doc.elderHand) || DEFAULTS.rpsDefaults.elderHand;

                    // fetch per-guild minigame stats
                    const mm = await miniStatsCol.findOne({ guildId: String(guild.id) }).catch(() => null);
                    const mmSuccesses = mm && mm.successes ? mm.successes : (mm && mm.responseCount ? mm.responseCount : 0);
                    const mmFailures = mm && mm.failures ? mm.failures : 0;
                    const mmTotalResponse = mm && mm.totalResponseMs ? mm.totalResponseMs : 0;
                    const mmAvgMs = mmSuccesses > 0 ? Math.round(mmTotalResponse / mmSuccesses) : 0;

                            const gStats = doc.stats || {};
                            // compute per-player earnable stars: base + redistributed share
                            const campersCount = await db.collection('campers').countDocuments();
                            const num = Math.max(1, campersCount);
                            const shared = (doc && typeof doc.starsPool === 'number') ? doc.starsPool : 0;
                            const extraPer = Math.floor(shared / num);
                            const perPlayer = DEFAULTS.houseStars + extraPer;

                            const embed = new EmbedBuilder()
                                .setTitle('House Daily Update')
                                .setColor(color)
                                .addFields(
                                    { name: 'Star Pool (shared)', value: String(shared), inline: true },
                                    { name: 'Earnable Today (per player)', value: String(perPlayer), inline: true },
                                    { name: 'RPSH Cards', value: `R:${rocks} P:${papers} S:${scissors} H:${elder}`, inline: true },
                                    { name: 'MiniGame (guild)', value: `Successes: ${mmSuccesses}  Failures: ${mmFailures}\nAvg Response: ${mmSuccesses ? (mmAvgMs/1000).toFixed(2) + 's' : '<n/a>'}`, inline: false },
                                    { name: 'Gambling Stats', value: `Card W/L: ${gStats.cardWins||0}/${gStats.cardLosses||0}\nBlackjack W/L: ${gStats.bjWins||0}/${gStats.bjLosses||0}\nRPS W/L: ${gStats.rpsWins||0}/${gStats.rpsLosses||0}\nTotal Bets: ${gStats.totalBets||0}\nTotal Payouts: ${gStats.totalPayouts||0}`, inline: false }
                                ).setTimestamp();
                    if (thumbnail) embed.setThumbnail(thumbnail);

                    await channel.send({ embeds: [embed] }).catch(() => null);
                } catch (e) { console.error('daily house notifier error for guild', guild.id, e); }
            }
        } catch (e) { console.error('startDailyNotifier postOnce error', e); }
    }

    // schedule daily at 09:00 America/New_York
    postOnce();
    try {
        cron.schedule('0 9 * * *', postOnce, { timezone: 'America/New_York' });
    } catch (e) { console.error('startDailyNotifier cron schedule error', e); }
}

// Start a daily cron job to run maintenance. Default: daily at 09:00 (America/New_York)
function startWeeklyManager({ cronExpression = '0 9 * * *', runOnStart = true, timezone = 'America/New_York' } = {}) {
    try {
        if (runOnStart) {
            performWeeklyMaintenance().catch(e => console.error('initial weekly maintenance error', e));
        }
        const task = cron.schedule(cronExpression, async () => {
            try { await performWeeklyMaintenance(); } catch (e) { console.error('weekly maintenance cron error', e); }
        }, timezone ? { timezone } : {});
        return task;
    } catch (e) { console.error('startWeeklyManager error', e); return null; }
}

module.exports = { getResources, performWeeklyRpsRefill, performCamperGrant, performDailyCamperRefresh: performCamperGrant, performHouseStarRefill, performWeeklyMaintenance, startWeeklyManager, startDailyNotifier };
