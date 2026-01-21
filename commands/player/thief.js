const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../../utils/mongodbUtil');
const fs = require('fs');
const path = require('path');
// track users who currently have a pending /thief in progress
const pendingThief = new Set();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('thief')
        .setDescription('Attempt to steal stars from another camper')
        .addUserOption(opt => opt.setName('target').setDescription('Player to rob').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Number of stars to steal').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
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
            // Do not reject attempts where requested amount > current stars.
            // We'll cap the stolen amount at transfer time to avoid overdrawing.

            // Validate requested amount against target's current stars at issue time
            if (amount > targetStars) {
                const e = new EmbedBuilder().setTitle('Not Enough Stars').setDescription(`Target only has ${targetStars} stars.`).setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            // Prevent the thief from starting another /thief while one is pending
            if (pendingThief.has(String(interaction.user.id))) {
                const e = new EmbedBuilder().setTitle('Already Pending').setDescription('You already have a pending /thief attempt. Wait until it resolves.').setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            // Prepare assets
            const assetsDir = path.join(__dirname, '..', '..', 'assets');
            const robberyImg = fs.existsSync(path.join(assetsDir, 'robbery.jpg')) ? path.join(assetsDir, 'robbery.jpg') : null;
            const arrestedImg = fs.existsSync(path.join(assetsDir, 'arrested.png')) ? path.join(assetsDir, 'arrested.png') : null;
            const gotawayImg = fs.existsSync(path.join(assetsDir, 'gotaway.jpg')) ? path.join(assetsDir, 'gotaway.jpg') : null;

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
                const e = new EmbedBuilder().setTitle('Delivery Failed').setDescription('Could not deliver quicktime to target.').setColor(0xFF0000);
                if (thumbnail) e.setThumbnail(thumbnail);
                return await interaction.editReply({ embeds: [e], ephemeral: true });
            }

            // Notify thief that attempt was sent
            const pending = new EmbedBuilder().setTitle('Attempt Started').setDescription(`Quicktime sent to ${targetUser.username}. Waiting ${10 * amount} seconds for BLOCK.`).setColor(embedColor);
            if (thumbnail) pending.setThumbnail(thumbnail);
            // mark this user as having a pending thief attempt
            pendingThief.add(String(interaction.user.id));
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
                // release pending lock
                pendingThief.delete(String(interaction.user.id));
                collector.stop('blocked');
            });

            collector.on('end', async (_, reason) => {
                // ensure pending lock removed for all outcomes
                try {
                    if (blocked) return; // already handled in collect

                    // thief got away: perform star transfer
                    try {
                        // re-fetch target to get current available stars
                        const freshTarget = await campers.findOne({ discordId: targetUser.id });
                        const available = (freshTarget && freshTarget.inventory && typeof freshTarget.inventory.stars === 'number') ? freshTarget.inventory.stars : 0;
                        const stealAmount = Math.min(amount, Math.max(0, available));

                        // decrement target (only if >0), increment thief, set lastThiefAt
                        if (stealAmount > 0) {
                            await campers.updateOne({ discordId: targetUser.id }, { $inc: { 'inventory.stars': -stealAmount } });
                        }
                        await campers.updateOne({ discordId: interaction.user.id }, { $inc: { 'inventory.stars': stealAmount }, $set: { lastThiefAt: new Date() } });

                        // fetch updated thief record for display
                        const updatedThief = await campers.findOne({ discordId: interaction.user.id });
                        const newTotal = (updatedThief.inventory && typeof updatedThief.inventory.stars === 'number') ? updatedThief.inventory.stars : 0;

                        // edit victim embed to indicate thief got away
                        const failEmbed = new EmbedBuilder()
                            .setTitle('The Thief Got Away')
                            .setDescription(`You didn't type BLOCK in time. The thief escaped with ${stealAmount} star${stealAmount===1?'':'s'}.`)
                            .setColor(0xFF9900)
                            .setTimestamp();
                        if (thumbnail) failEmbed.setThumbnail(thumbnail);
                        if (gotawayImg) failEmbed.setImage('attachment://gotaway' + path.extname(gotawayImg));
                        try { await sentMsg.edit({ embeds: [failEmbed], files: gotawayImg ? [{ attachment: gotawayImg, name: 'gotaway' + path.extname(gotawayImg) }] : [], components: [] }); } catch (e) {}

                        // send result embed to thief in their confessional or DM
                        const resultEmbed = new EmbedBuilder()
                            .setTitle('Robbery Successful')
                            .setDescription(`You successfully stole ${stealAmount} star${stealAmount===1?'':'s'} from ${targetUser.username}.`)
                            .setColor(embedColor)
                            .addFields(
                                { name: 'Stars Stolen', value: `+${stealAmount}`, inline: true },
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
                    pendingThief.delete(String(interaction.user.id));
                }
            });

        } catch (err) {
            console.error('thief command error', err);
            // ensure pending lock cleared if something failed after it was set
            try { pendingThief.delete(String(interaction.user.id)); } catch (e) {}
            try { await interaction.editReply({ content: 'There was an error running /thief.', ephemeral: true }); } catch (e) {}
        }
    }
};