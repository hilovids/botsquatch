const { EmbedBuilder } = require('discord.js');
const path = require('path');

function tokenAssetForKey(key) {
    const map = {
        immunityTokens: 'immunity_token.png',
        seanceTokens: 'seance_token.png',
        timeTokens: 'time_token.png',
        nothingTokens: 'nothing_token.png',
        eggToken: 'egg_token.png',
        voteTokens: 'vote_board.png'
    };
    return map[key] || null;
}

function curseAssetForKey(key) {
    const map = {
        noVote: 'haunt_curse.png',
        silent: 'silent_curse.png',
        confused: 'confusion_curse.png',
    };
    return map[key] || null;
}

async function buildEmbedFromChange(change, fullDoc, updateDesc, discordConfig) {
    // fullDoc is the camper after change
    const updated = updateDesc && updateDesc.updatedFields ? updateDesc.updatedFields : {};
    const removed = updateDesc && updateDesc.removedFields ? updateDesc.removedFields : [];

    const embeds = [];
    const files = [];

    // helper to push embed + file
    function pushEmbed(title, description, color = 0x00FF00, imgFilename = null, imgName = null) {
        const emb = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
        if (imgFilename && imgName) {
            emb.setImage(`attachment://${imgName}`);
            files.push({ attachment: imgFilename, name: imgName });
        }
        embeds.push(emb);
    }

    // detect inventory changes
    for (const key of Object.keys(updated)) {
        if (key.startsWith('inventory.')) {
            const ik = key.split('.')[1];
            const img = tokenAssetForKey(ik);
            const newVal = updated[key];
            // best-effort: treat as an award
            if (ik === 'coins') {
                const emoji = '💰';
                pushEmbed('You earned coins!', `${emoji} You now have **${newVal}** coin(s).`, discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFFD700);
            } else if (ik === 'stars') {
                const emoji = '⭐';
                pushEmbed('You earned stars!', `${emoji} You now have **${newVal}** star(s).`, discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFFD700);
            } else if (img) {
                const imgPath = path.join(__dirname, '../assets', img);
                pushEmbed('You received a token!', `You now have **${newVal}** ${ik.replace(/([A-Z])/g, ' $1').trim()}.`, discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00FF00, imgPath, img);
            } else {
                // generic notification
                pushEmbed('Inventory updated', `Your **${ik}** was updated to **${newVal}**.`, discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00FF00);
            }
        }
    }

    // detect curses
    for (const key of Object.keys(updated)) {
        if (key.startsWith('curses.')) {
            const ck = key.split('.')[1];
            const newVal = updated[key];
            if (newVal) {
                const img = curseAssetForKey(ck);
                const imgPath = img ? path.join(__dirname, '../assets', img) : null;
                pushEmbed('A curse has been applied...', `You have been afflicted with **${ck}**.`, 0x8B0000, imgPath, img);
            }
        }
    }

    // detect badge additions
    // updated may include 'badges' (full array) or 'badges.<index>' keys
    const badgeKeys = Object.keys(updated).filter(k => k === 'badges' || k.startsWith('badges.'));
    if (badgeKeys.length > 0) {
        // Determine newly added badges by comparing length or taking the last element
        const badges = Array.isArray(fullDoc.badges) ? fullDoc.badges : [];
        if (badges.length > 0) {
            // assume last badge(s) are new
            const last = badges[badges.length - 1];
            const badgeFilename = last && typeof last === 'string' ? `${last}.png` : null;
            const badgePath = badgeFilename ? path.join(__dirname, '../assets/badges', badgeFilename) : null;
            if (badgePath) {
                pushEmbed('You earned a Badge!', `You've earned the **${last}** badge.`, discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFFD700, badgePath, badgeFilename);
            } else {
                pushEmbed('You earned a Badge!', `You've earned the **${last}** badge.`, discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFFD700);
            }
        }
    }

    return { embeds, files };
}

module.exports = { buildEmbedFromChange };
