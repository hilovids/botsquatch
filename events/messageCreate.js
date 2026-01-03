const { Events, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../utils/mongodbUtil');
const path = require('path');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        try {
            // console.log('messageCreate event fired');
            if (!message || !message.author) return;
            if (message.author.bot) return;

            // Only enforce in guild contexts (ignore system/webhooks/other bots)
            const isGuildMessage = !!message.guild;

            const db = await connectToMongo();
            const campersCol = db.collection('campers');
            const alliancesCol = db.collection('alliances');

            const camper = await campersCol.findOne({ discordId: String(message.author.id) });
            if (!camper) {
                return; // not a registered player
            }

            const curses = camper.curses || {};

            // 1) Silent curse: cannot send messages in alliance channels
            if (curses.silent) {
                let isAlliance = false;
                try {
                    if (isGuildMessage) {
                        // prefer DB-backed check: is this channel an alliance channel?
                        const alliance = await alliancesCol.findOne({ guildId: message.guild.id, channelId: message.channel.id });
                        if (alliance) {
                            isAlliance = true;
                            // console.log('[curses] silent: channel matched alliance by DB', { author: message.author.id, channel: message.channel.id, allianceId: String(alliance._id) });
                        }
                        // fallback: channel name prefix
                        if (!isAlliance && message.channel.name && message.channel.name.startsWith && message.channel.name.startsWith('alliance-')) {
                            isAlliance = true;
                            // console.log('[curses] silent: channel matched alliance by name prefix', { author: message.author.id, channel: message.channel.id, channelName: message.channel.name });
                        }
                    }
                } catch (e) { console.error('[curses] alliance detection error', e); }

                if (isAlliance) {
                    // console.log('[curses] silent: deleting message and notifying user in-channel', { author: message.author.id, channel: message.channel.id });
                    // prevent message from being posted
                    try { await message.delete().catch(() => { }); } catch (e) { console.error('[curses] error deleting message', e); }

                    // notify the user in-channel and auto-delete the bot message shortly after to mimic ephemeral
                    try {
                        const display = camper.displayName || (message.member && message.member.displayName) || message.author.username;
                        const embed = new EmbedBuilder()
                            .setDescription(`${display} tries to speak, but the spirits of silence stop their tongue.`)
                            .setColor(0x6B5B95)
                            .setImage('attachment://silent_curse.png');
                        const assetPath = path.join(__dirname, '..', 'assets', 'silent_curse.png');
                        const botMsg = await message.channel.send({ embeds: [embed], files: [{ attachment: assetPath, name: 'silent_curse.png' }], allowedMentions: { repliedUser: false } }).catch(() => null);
                        if (botMsg) setTimeout(() => botMsg.delete().catch(() => { }), 8000);
                    } catch (e) { console.error('[curses] silent in-channel notify error', e); }
                    return;
                }
            }

            // 2) Confused curse: outside of confessional, messages must be at most 3 words
            if (curses.confused) {
                const confId = camper.confessionalId ? String(camper.confessionalId) : null;
                const inConfessional = confId && isGuildMessage && String(message.channel.id) === confId;
                if (!inConfessional) {
                    const content = (message.content || '').trim();
                    // count words; attachments with no text are allowed (count = 0)
                    const words = content.length ? content.split(/\s+/).filter(Boolean) : [];
                    if (words.length > 3) {
                        try { await message.delete().catch(() => { }); } catch (e) { console.error('[curses] error deleting message', e); }
                        try {
                            const display = camper.displayName || (message.member && message.member.displayName) || message.author.username;
                            const embed = new EmbedBuilder()
                                .setDescription(`${display} speaks, but the words tumble into confusion. They can only manage 3 word sentences.`)
                                .setColor(0x6B5B95)
                                .setImage('attachment://confusion_curse.png');
                            const assetPath = path.join(__dirname, '..', 'assets', 'confusion_curse.png');
                            const botMsg = await message.channel.send({ embeds: [embed], files: [{ attachment: assetPath, name: 'confusion_curse.png' }], allowedMentions: { repliedUser: false } }).catch(() => null);
                            if (botMsg) setTimeout(() => botMsg.delete().catch(() => { }), 8000);
                        } catch (e) { console.error('[curses] confused in-channel notify error', e); }
                        return;
                    }
                }
            }

        } catch (err) {
            console.error('messageCreate curses enforcement error', err);
        }
    }
}