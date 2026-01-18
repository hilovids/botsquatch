const { connectToMongo } = require('./mongodbUtil');

async function getResources() {
    const db = await connectToMongo();
    const col = db.collection('gambling_state');
    const doc = await col.findOne({ _id: 'global' });
    if (!doc) return null;
    return {
        payouts: {
            card: { multiplier: 2.5, note: '1/3 chance, gold pays 25x' },
            blackjack: { multiplier: 2.0, note: 'standard 2x payout' },
            rps: { multiplier: 2.0, note: 'simple payout' }
        },
        counts: {
            rocks: doc.rocks || 0,
            papers: doc.papers || 0,
            scissors: doc.scissors || 0,
            elderHand: doc.elderHand || 0
        },
        starsPool: doc.starsPool || 0,
        stats: doc.stats || {},
        lastPayoutAt: doc.lastPayoutAt || null,
        lastPayoutRecipient: doc.lastPayoutRecipient || null
    };
}

async function performWeeklyPayout() {
    const db = await connectToMongo();
    const col = db.collection('gambling_state');
    const campers = db.collection('campers');
    const doc = await col.findOne({ _id: 'global' });
    if (!doc) return { ok: false, reason: 'no state' };

    const now = new Date();
    const last = doc.lastPayoutAt ? new Date(doc.lastPayoutAt) : new Date(0);
    const twoDays = 2 * 24 * 60 * 60 * 1000;
    if (now - last < twoDays) return { ok: false, reason: 'not due yet' };

    const pool = doc.starsPool || 0;
    if (pool <= 30) {
        // nothing to pay out, but update lastPayoutAt
        await col.updateOne({ _id: 'global' }, { $set: { lastPayoutAt: now } });
        return { ok: true, paid: 0, recipient: null };
    }

    const toPay = pool - 30;

    // try to find the receiver camper (hilovids or hilo)
    const receiver = await campers.findOne({ $or: [ { username: /hilovids/i }, { displayName: /hilo/i }, { username: /hilo/i } ] });
    if (!receiver) {
        // cannot find recipient, do not drain pool; instead reset lastPayoutAt and keep pool
        await col.updateOne({ _id: 'global' }, { $set: { lastPayoutAt: now } });
        return { ok: false, reason: 'recipient not found' };
    }

    await campers.updateOne({ _id: receiver._id }, { $inc: { 'inventory.stars': toPay } });
    // advance nextWeeklyCashoutAt to next 2-day midnight
    function computeNext2DayMidnight(from) {
        const next = new Date(from);
        next.setHours(0,0,0,0);
        next.setDate(next.getDate() + 2);
        return next;
    }
    const nextWeekly = computeNext2DayMidnight(now);
    await col.updateOne({ _id: 'global' }, { $set: { starsPool: 30, lastPayoutAt: now, lastPayoutRecipient: receiver._id, nextWeeklyCashoutAt: nextWeekly } });

    return { ok: true, paid: toPay, recipient: receiver._id };
}

function scheduleAt(time, fn) {
    const now = new Date();
    const then = new Date(time);
    const ms = then - now;
    if (ms <= 0) {
        // run immediately next tick
        setTimeout(fn, 0);
        return setTimeout(() => scheduleAt(time, fn), 24 * 60 * 60 * 1000);
    }
    return setTimeout(fn, ms);
}

// weekly watcher: schedule payout according to persisted `nextWeeklyCashoutAt`
async function startWeeklyWatcher() {
    try {
        const db = await connectToMongo();
        const col = db.collection('gambling_state');
        const doc = await col.findOne({ _id: 'global' });
        if (!doc) return;
        const nextWeekly = doc.nextWeeklyCashoutAt ? new Date(doc.nextWeeklyCashoutAt) : null;
            const handler = async () => {
                try {
                    await performHouseMaintenance();
                    // refresh doc and reschedule
                    const updated = await col.findOne({ _id: 'global' });
                    const next = updated && updated.nextWeeklyCashoutAt ? new Date(updated.nextWeeklyCashoutAt) : null;
                    if (next) scheduleAt(next, handler);
                } catch (e) { console.error('weekly watcher handler error', e); }
            };
        if (nextWeekly) scheduleAt(nextWeekly, handler);
    } catch (e) { console.error('startWeeklyWatcher error', e); }
}

// start watcher automatically
startWeeklyWatcher();

// Post a daily summary to each guild: time until weekly cashout and RPSH counts
async function startDailyNotifier(client) {
    if (!client) return;
    const db = await connectToMongo();
    const col = db.collection('gambling_state');
    const discordConfigs = db.collection('discordConfigs');

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
            const now = new Date();
            const until = doc && doc.nextWeeklyCashoutAt ? (new Date(doc.nextWeeklyCashoutAt) - now) : 0;

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
                    if (!channel) channel = guild.channels.cache.find(c => c.name && c.name.toLowerCase() === 'campground' && typeof c.send === 'function') || null;
                    if (!channel && guild.systemChannel && typeof guild.systemChannel.send === 'function') channel = guild.systemChannel;
                    if (!channel) channel = guild.channels.cache.find(c => typeof c.send === 'function') || null;
                    if (!channel) continue;

                    const rocks = (doc && doc.rocks) || 0;
                    const papers = (doc && doc.papers) || 0;
                    const scissors = (doc && doc.scissors) || 0;
                    const elder = (doc && doc.elderHand) || 0;

                    const embed = require('discord.js').EmbedBuilder && new (require('discord.js')).EmbedBuilder()
                        .setTitle('House Daily Update')
                        .setColor(color)
                        .addFields(
                            { name: 'Time until weekly cashout', value: msToHuman(until), inline: true },
                            {name: 'Star Pool', value: `${ (doc && doc.starsPool) || 0 }`, inline: true },
                            { name: 'RPSH Cards', value: `${rocks + papers + scissors + elder}`, inline: true }
                        ).setTimestamp();
                    if (thumbnail) embed.setThumbnail(thumbnail);

                    await channel.send({ embeds: [embed] }).catch(() => null);
                } catch (e) { console.error('daily house notifier error for guild', guild.id, e); }
            }
        } catch (e) { console.error('startDailyNotifier postOnce error', e); }
    }

    // post once immediately and then every hour (frequent checks for missed updates)
    postOnce();
    setInterval(postOnce, 60 * 60 * 1000);
}

module.exports = { getResources, performWeeklyPayout, startWeeklyWatcher, startDailyNotifier };

// Ensure each camper has at least one R/P/S per day
async function startDailyCamperRefresh() {
    try {
        const db = await connectToMongo();
        const campers = db.collection('campers');
        const col = db.collection('gambling_state');

        function computeNextMidnight(from) {
            const next = new Date(from);
            next.setHours(0,0,0,0);
            next.setDate(next.getDate() + 1);
            return next;
        }

        async function refreshOnce() {
            try {
                // ensure minimum 1 of each without reducing existing counts
                await campers.updateMany({}, { $max: { 'inventory.rpsRock': 1, 'inventory.rpsPaper': 1, 'inventory.rpsScissors': 1 } });
                // advance nextDailyResetAt
                const now = new Date();
                const next = computeNextMidnight(now);
                await col.updateOne({ _id: 'global' }, { $set: { nextDailyResetAt: next } });
            } catch (e) { console.error('daily camper refresh error', e); }
        }

        // schedule according to persisted timestamp
        const state = await col.findOne({ _id: 'global' });
        const now = new Date();
        let next = state && state.nextDailyResetAt ? new Date(state.nextDailyResetAt) : computeNextMidnight(now);

        const schedule = async () => {
            await refreshOnce();
            // compute next and schedule
            const dbState = await col.findOne({ _id: 'global' });
            const nextAgain = dbState && dbState.nextDailyResetAt ? new Date(dbState.nextDailyResetAt) : computeNextMidnight(new Date());
            const ms = nextAgain - new Date();
            setTimeout(schedule, ms <= 0 ? 0 : ms);
        };

        const ms = next - now;
        setTimeout(schedule, ms <= 0 ? 0 : ms);
    } catch (e) { console.error('startDailyCamperRefresh error', e); }
}

// perform a one-shot daily camper refresh
async function performDailyCamperRefresh() {
    try {
        const db = await connectToMongo();
        const campers = db.collection('campers');
        await campers.updateMany({}, { $max: { 'inventory.rpsRock': 1, 'inventory.rpsPaper': 1, 'inventory.rpsScissors': 1 } });
        return { ok: true };
    } catch (e) { console.error('performDailyCamperRefresh error', e); return { ok: false, error: String(e) }; }
}

// Weekly refill for house RPSH cards
async function performWeeklyRpsRefill() {
    const db = await connectToMongo();
    const col = db.collection('gambling_state');
    const doc = await col.findOne({ _id: 'global' });
    if (!doc) return { ok: false, reason: 'no state' };
    const now = new Date();
    const last = doc.lastRpsRefillAt ? new Date(doc.lastRpsRefillAt) : new Date(0);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (now - last < sevenDays) return { ok: false, reason: 'not due' };

    // reset counts to defaults
    const defaults = { rocks: 10, papers: 10, scissors: 10, elderHand: 1 };
    await col.updateOne({ _id: 'global' }, { $set: { ...defaults, lastRpsRefillAt: now } }, { upsert: true });
    return { ok: true, set: defaults };
}

// Combined maintenance: payout (every 2 days) and RPSH refill (weekly)
async function performHouseMaintenance() {
    try {
        const payoutRes = await performWeeklyPayout().catch(e => { console.error('performWeeklyPayout error', e); return null; });
        const rpsRes = await performWeeklyRpsRefill().catch(e => { console.error('performWeeklyRpsRefill error', e); return null; });
        return { ok: true, payout: payoutRes, rps: rpsRes };
    } catch (e) { console.error('performHouseMaintenance error', e); return { ok: false, error: String(e) }; }
}

// call weekly refill from the existing weekly watcher as well
const _origStartWeeklyWatcher = startWeeklyWatcher;
function startWeeklyWatcherWithRefill() {
    _origStartWeeklyWatcher();
    // also run hourly maintenance check for payouts and RPS refill (handles missed events)
    setInterval(async () => {
        try { await performHouseMaintenance(); } catch (e) { console.error('house maintenance error', e); }
    }, 60 * 60 * 1000);
}

module.exports = { getResources, performWeeklyPayout, startWeeklyWatcher: startWeeklyWatcherWithRefill, startDailyNotifier, startDailyCamperRefresh, performWeeklyRpsRefill, performDailyCamperRefresh };
