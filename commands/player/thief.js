const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const fs = require('fs');
const path = require('path');

// Track active thief commands per user ID to prevent spamming
const activeThieves = new Set();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('thief')
        .setDescription('Attempt to steal stars from another camper')
        .addUserOption(opt => opt.setName('target').setDescription('Player to rob').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Number of stars to steal').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        // prevent concurrent thief attempts per player
        if (activeThieves.has(interaction.user.id)) {
            return await interaction.editReply({ content: 'You already have an active /thief attempt. Please wait until it completes.', ephemeral: true });
        }
        try {
            const db = await connectToMongo();
            const campers = db.collection('campers');
            const discordConfigs = db.collection('discordConfigs');
            const discordConfig = await discordConfigs.findOne({ server_id: interaction.guildId });
            const embedColor = discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x0099ff;
            const thumbnail = discordConfig && discordConfig.embed && discordConfig.embed.thumbnail_url ? discordConfig.embed.thumbnail_url : null;

            const targetUser = interaction.options.getUser('target');
            const amount = parseInt(interaction.options.getInteger('amount'), 10);

            if (!targetUser) return await interaction.editReply({ content: 'Invalid target.', ephemeral: true });
            if (!Number.isInteger(amount) || amount <= 0) return await interaction.editReply({ content: 'Amount must be a positive integer.', ephemeral: true });
            if (String(targetUser.id) === String(interaction.user.id)) return await interaction.editReply({ content: 'You cannot rob yourself.', ephemeral: true });

            const thief = await campers.findOne({ discordId: interaction.user.id });
            if (!thief) {
                const e = new EmbedBuilder().setTitle('No Profile').setDescription('Your camper profile was not found. Use /join first.').setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            if (thief.eliminated) {
                const e = new EmbedBuilder().setTitle('Cannot Rob').setDescription('Eliminated campers cannot use this command.').setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            // daily cooldown check
            if (thief.lastThiefAt) {
                const last = new Date(thief.lastThiefAt);
                const now = new Date();
                const sameDay = last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth() && last.getDate() === now.getDate();
                if (sameDay) {
                    const e = new EmbedBuilder().setTitle('Cooldown').setDescription('You can only use /thief once per calendar day.').setColor(0xFF0000);
                    if (thumbnail) e.setThumbnail(thumbnail);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }
            }

            const target = await campers.findOne({ discordId: targetUser.id });
            if (!target) {
                const e = new EmbedBuilder().setTitle('Target Not Found').setDescription('Target camper profile not found.').setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            const targetStars = (target.inventory && typeof target.inventory.stars === 'number') ? target.inventory.stars : 0;
            if (amount > targetStars) {
                const e = new EmbedBuilder().setTitle('Not Enough Stars').setDescription(`Target only has ${targetStars} stars.`).setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            // Prepare assets
            const assetsDir = path.join(__dirname, '..', '..', 'assets');
            const robberyImg = fs.existsSync(path.join(assetsDir, 'robbery.jpg')) ? path.join(assetsDir, 'robbery.jpg') : null;
            const arrestedImg = fs.existsSync(path.join(assetsDir, 'arrested.png')) ? path.join(assetsDir, 'arrested.png') : null;
            const gotawayImg = fs.existsSync(path.join(assetsDir, 'gotaway.jpg')) ? path.join(assetsDir, 'gotaway.jpg') : null;

            // mark this user as having an active thief attempt
            activeThieves.add(interaction.user.id);

            // Send quicktime embed into target's confessional or DM
            const qtEmbed = new EmbedBuilder()
                .setTitle('Quick! A Thief!')
                .setDescription(`Someone is trying to steal ${amount} star${amount===1?'':'s'} from you! Type BLOCK in this channel within ${10 * amount} seconds to stop them.`)
                .setColor(embedColor)
                .setTimestamp();
            if (thumbnail) qtEmbed.setThumbnail(thumbnail);
            if (robberyImg) qtEmbed.setImage('attachment://robbery' + path.extname(robberyImg));

            let destChannel = null;
            let sentMsg = null;
            if (target.confessionalId) {
                const chan = await interaction.client.channels.fetch(target.confessionalId).catch(() => null);
                if (chan) {
                    destChannel = chan;
                    sentMsg = await chan.send({ content: `<@${targetUser.id}>`, embeds: [qtEmbed], files: robberyImg ? [{ attachment: robberyImg, name: 'robbery' + path.extname(robberyImg) }] : [] }).catch(() => null);
                }
            }
            if (!sentMsg) {
                // fallback to DM
                const userObj = await interaction.client.users.fetch(targetUser.id).catch(() => null);
                if (!userObj) {
                    const e = new EmbedBuilder().setTitle('Delivery Failed').setDescription('Could not deliver quicktime to target.').setColor(0xFF0000);
                    if (thumbnail) e.setThumbnail(thumbnail);
                    return await interaction.editReply({ embeds: [e], ephemeral: true });
                }
                destChannel = (await userObj.createDM());
                sentMsg = await destChannel.send({ content: `<@${targetUser.id}>`, embeds: [qtEmbed], files: robberyImg ? [{ attachment: robberyImg, name: 'robbery' + path.extname(robberyImg) }] : [] }).catch(() => null);
            }

            if (!sentMsg) {
                // clear lock before returning
                activeThieves.delete(interaction.user.id);
                const e = new EmbedBuilder().setTitle('Delivery Failed').setDescription('Could not deliver quicktime to target.').setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            // Notify thief that attempt was sent
            const pending = new EmbedBuilder().setTitle('Attempt Started').setDescription(`Quicktime sent to ${targetUser.username}. Waiting ${10 * amount} seconds for BLOCK.`).setColor(embedColor);
            if (thumbnail) pending.setThumbnail(thumbnail);
            await interaction.editReply({ embeds: [pending], ephemeral: true });

            // create collector on destChannel for BLOCK message from targetUser
            const timeoutMs = 1000 * 10 * amount;
            const filter = m => m.author && String(m.author.id) === String(targetUser.id) && m.content && m.content.trim() === 'BLOCK';
            const collector = destChannel.createMessageCollector({ filter, time: timeoutMs });

            let blocked = false;
            collector.on('collect', async (m) => {
                blocked = true;
                // edit the original quicktime embed to indicate arrested
                const doneEmbed = new EmbedBuilder()
                    .setTitle('Thief Apprehended')
                    .setDescription(`You stopped the thief! It was ${thief.username}...`)
                    .setColor(0x00FF00)
                    .setTimestamp();
                if (thumbnail) doneEmbed.setThumbnail(thumbnail);
                if (arrestedImg) doneEmbed.setImage('attachment://arrested' + path.extname(arrestedImg));
                try { await sentMsg.edit({ embeds: [doneEmbed], files: arrestedImg ? [{ attachment: arrestedImg, name: 'arrested' + path.extname(arrestedImg) }] : [], components: [] }); } catch (e) {}
                collector.stop('blocked');
            });

            collector.on('end', async (_, reason) => {
                try {
                    if (blocked) return; // already handled

                    // thief got away: perform star transfer but clamp to available stars
                    try {
                    // refresh target to get current available stars
                    let freshTarget = await campers.findOne({ discordId: targetUser.id });
                    let available = (freshTarget && freshTarget.inventory && typeof freshTarget.inventory.stars === 'number') ? freshTarget.inventory.stars : 0;
                    let toSteal = Math.min(amount, available);

                    // attempt to decrement atomically when possible
                    if (toSteal > 0) {
                        // try a guarded decrement that only succeeds if enough stars still exist
                        const guard = await campers.findOneAndUpdate(
                            { discordId: targetUser.id, 'inventory.stars': { $gte: toSteal } },
                            { $inc: { 'inventory.stars': -toSteal } },
                            { returnDocument: 'after' }
                        );

                        if (!guard.value) {
                            // not enough by the time of update, refresh and recompute
                            freshTarget = await campers.findOne({ discordId: targetUser.id });
                            available = (freshTarget && freshTarget.inventory && typeof freshTarget.inventory.stars === 'number') ? freshTarget.inventory.stars : 0;
                            toSteal = Math.min(amount, available);
                            if (toSteal > 0) {
                                // decrement whatever is available now
                                await campers.updateOne({ discordId: targetUser.id }, { $inc: { 'inventory.stars': -toSteal } });
                            }
                        }
                    }

                    // always set thief cooldown; only credit stars if toSteal > 0
                    if (toSteal > 0) {
                        await campers.updateOne({ discordId: interaction.user.id }, { $inc: { 'inventory.stars': toSteal }, $set: { lastThiefAt: new Date() } });
                    } else {
                        await campers.updateOne({ discordId: interaction.user.id }, { $set: { lastThiefAt: new Date() } });
                    }

                    // ensure target doesn't have negative stars (defensive)
                    const postTarget = await campers.findOne({ discordId: targetUser.id });
                    if (postTarget && postTarget.inventory && typeof postTarget.inventory.stars === 'number' && postTarget.inventory.stars < 0) {
                        await campers.updateOne({ discordId: targetUser.id }, { $set: { 'inventory.stars': 0 } });
                    }

                    // fetch updated thief record for display
                    const updatedThief = await campers.findOne({ discordId: interaction.user.id });
                    const newTotal = (updatedThief.inventory && typeof updatedThief.inventory.stars === 'number') ? updatedThief.inventory.stars : 0;

                    // edit victim embed to indicate thief got away (use actual stolen amount)
                    const failEmbed = new EmbedBuilder()
                        .setTitle('The Thief Got Away')
                        .setDescription(`You didn't type BLOCK in time. The thief escaped with ${toSteal} star${toSteal===1?'':'s'}.`)
                        .setColor(0xFF9900)
                        .setTimestamp();
                    if (thumbnail) failEmbed.setThumbnail(thumbnail);
                    if (gotawayImg) failEmbed.setImage('attachment://gotaway' + path.extname(gotawayImg));
                    try { await sentMsg.edit({ embeds: [failEmbed], files: gotawayImg ? [{ attachment: gotawayImg, name: 'gotaway' + path.extname(gotawayImg) }] : [], components: [] }); } catch (e) {}

                    // send result embed to thief in their confessional or DM
                    const resultEmbed = new EmbedBuilder()
                        .setTitle('Robbery Successful')
                        .setDescription(`You successfully stole ${toSteal} star${toSteal===1?'':'s'} from ${targetUser.username}.`)
                        .setColor(embedColor)
                        .addFields(
                            { name: 'Stars Stolen', value: `+${toSteal}`, inline: true },
                            { name: 'Your Stars', value: `${newTotal}`, inline: true }
                        )
                        .setTimestamp();
                    if (thumbnail) resultEmbed.setThumbnail(thumbnail);

                    // send to thief confessional or DM
                    if (thief.confessionalId) {
                        const ch = await interaction.client.channels.fetch(thief.confessionalId).catch(() => null);
                        if (ch) await ch.send({ embeds: [resultEmbed] }).catch(() => null);
                        else {
                            const u = await interaction.client.users.fetch(interaction.user.id).catch(() => null);
                            if (u) await u.send({ embeds: [resultEmbed] }).catch(() => null);
                        }
                    } else {
                        const u = await interaction.client.users.fetch(interaction.user.id).catch(() => null);
                        if (u) await u.send({ embeds: [resultEmbed] }).catch(() => null);
                    }

                    } catch (err) {
                        console.error('thief transfer error', err);
                    }
                } finally {
                    // release per-player lock no matter what
                    activeThieves.delete(interaction.user.id);
                }
            });
            
        } catch (err) {
            console.error('thief command error', err);
            // ensure lock cleared on unexpected errors
            try { activeThieves.delete(interaction.user.id); } catch (e) {}
            try { await interaction.editReply({ content: 'There was an error running /thief.', ephemeral: true }); } catch (e) {}
        }
    }
};
