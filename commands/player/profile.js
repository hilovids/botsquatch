const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const { connectToMongo } = require('../../utils/mongodbUtil');

const orderedKeys = ['creativity','social','mobility','puzzles','trivia','reflexes'];

function mapTimezone(tz) {
    if (!tz) return null;
    const map = {
        EST: 'America/New_York',
        BRT: 'America/Sao_Paulo',
        PST: 'America/Los_Angeles',
        CST: 'America/Chicago',
        MST: 'America/Denver',
    };
    if (map[tz]) return map[tz];
    // If it looks like an IANA zone already, return it
    if (tz.includes('/')) return tz;
    return null;
}

function formatTimeForTimezone(tz) {
    try {
        const iana = mapTimezone(tz);
        const now = new Date();
        if (iana) {
            return new Intl.DateTimeFormat('en-US', { timeZone: iana, hour: '2-digit', minute: '2-digit', hour12: true }).format(now);
        }
        // fallback: use system locale time
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return 'Unknown';
    }
}

// Stats graph generation removed — command now returns simple letter grades and profile picture only.

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Show a player profile and stand graph')
        .addUserOption(opt => opt.setName('user').setDescription('The user to view').setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const db = await connectToMongo();
            const campersCol = db.collection('campers');

            const userOpt = interaction.options.getUser('user') || interaction.user;
            const player = await campersCol.findOne({ discordId: userOpt.id });
            if (!player) {
                console.log(`profile: no profile found for discordId=${userOpt.id}`);
                await interaction.editReply({ content: `No profile found for ${userOpt.username}.` });
                return;
            }

            // Map numeric stats to letter grades (0->F,1->E,2->D,3->C,4->B,5->A,6->S). .5 -> +
            const gradeMap = {0:'F',1:'E',2:'D',3:'C',4:'B',5:'A',6:'S'};
            function gradeFromValue(v) {
                const num = Number(v) || 0;
                if (num >= 6) return 'S';
                const floor = Math.floor(num);
                const frac = num - floor;
                const base = gradeMap[floor] || '?';
                if (frac >= 0.5 && floor < 6) return base + '+';
                return base;
            }

            const fields = orderedKeys.map(k => {
                const raw = player.interview && typeof player.interview[k] !== 'undefined' ? player.interview[k] : 0;
                return { name: k.charAt(0).toUpperCase() + k.slice(1), value: `${gradeFromValue(raw)} (${raw})`, inline: true };
            });

            const display = player.displayName || player.username || userOpt.username;
            const usernameLine = `${player.username || userOpt.username}`;
            const pronouns = player.pronouns ? ` \n${player.pronouns}` : '';
            const timeStr = player.timezone ? `\nLocal time: ${formatTimeForTimezone(player.timezone)}` : '';

            const teamColorMap = {
                admin: '#f48c37',
                none: '#1abc9c',
                ferrets: '#46d6d2',
                wolves: '#e73b86'
            };
            const teamColor = teamColorMap[player.team] || '#1e90ff';

            const embed = new EmbedBuilder()
                .setTitle(`${display}'s Profile`)
                .setDescription(`${usernameLine}${pronouns}${timeStr ? timeStr : ''}`)
                .setColor(teamColor)
                .setTimestamp()
                .addFields(fields);

            // Attach profile picture (use stored assetName or default)
            const assetName = player.assetName || 'default.png';
            const pfpPath = path.join(__dirname, '../../assets/pfp', assetName);
            let attachment;
            if (fs.existsSync(pfpPath)) {
                attachment = new AttachmentBuilder(pfpPath, { name: assetName });
                embed.setThumbnail(`attachment://${assetName}`);
            }

            // Add goal/strategy as separate fields if present
            if (player.interview && player.interview.goal) embed.addFields({ name: 'Goal', value: String(player.interview.goal).slice(0, 1024) });
            if (player.interview && player.interview.strategy) embed.addFields({ name: 'Strategy', value: String(player.interview.strategy).slice(0, 1024) });

            // Add RPS stats if present
            const rpsWins = player.rpsWins || 0;
            const rpsLosses = player.rpsLosses || 0;
            const rpsChoices = player.rpsChoices || {};
            const rock = rpsChoices.rock || 0;
            const paper = rpsChoices.paper || 0;
            const scissors = rpsChoices.scissors || 0;
            const hand = rpsChoices.hand || 0;
            const totalChoices = rock + paper + scissors + hand;
            function pct(n) { if (!totalChoices) return '0%'; return `${((n / totalChoices) * 100).toFixed(1)}%`; }
            embed.addFields(
                { name: 'RPS Wins/Losses', value: `${rpsWins} / ${rpsLosses}`, inline: true },
                { name: 'Choice % (R/P/S/H)', value: `✊ ${pct(rock)} / ✋ ${pct(paper)} / ✌️ ${pct(scissors)} / 🖐️ ${pct(hand)}`, inline: true }
            );

            await interaction.editReply({ embeds: [embed], files: attachment ? [attachment] : [] });

        } catch (err) {
            console.error('profile command error', err);
            try { await interaction.editReply({ content: 'There was an error generating the profile.' }); } catch (e) {}
        }
    }
};
