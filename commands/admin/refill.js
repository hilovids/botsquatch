const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { performWeeklyRpsRefill, performDailyCamperRefresh } = require('../../utils/houseManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refill')
        .setDescription('Admin: trigger refill actions for house/campers')
        .addStringOption(opt => opt.setName('scope').setDescription('Which refill to run').setRequired(true)
            .addChoices(
                { name: 'House RPS (weekly refill)', value: 'rps_house' },
                { name: 'Daily camper refresh (give R/P/S)', value: 'campers_daily' },
                { name: 'Redistribute Star Pool (daily refill)', value: 'redistribute' },
                { name: 'Both', value: 'both' }
            ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const scope = interaction.options.getString('scope');
        try {
            let results = [];
            if (scope === 'rps_house' || scope === 'both') {
                const r = await performWeeklyRpsRefill();
                if (r && r.ok) results.push(`House RPS refill: OK (set ${JSON.stringify(r.set)})`);
                else results.push(`House RPS refill: Failed (${r && r.reason ? r.reason : (r && r.error ? r.error : 'unknown')})`);
            }
            if (scope === 'campers_daily' || scope === 'both') {
                const d = await performDailyCamperRefresh();
                if (d && d.ok) results.push('Daily camper refresh: OK');
                else results.push(`Daily camper refresh: Failed (${d && d.error ? d.error : 'unknown'})`);
            }
            if (scope === 'redistribute' || scope === 'both') {
                const m = await require('../../utils/houseManager').performWeeklyMaintenance();
                if (m && m.ok) results.push(`Redistribute star pool: OK (perPlayerExtra=${m.redistributed && m.redistributed.perCamperExtra}, remainder=${m.redistributed && m.redistributed.remainder})`);
                else results.push(`Redistribute star pool: Failed (${m && m.error ? m.error : 'unknown'})`);
            }

            const embed = new EmbedBuilder().setTitle('Refill Results').setDescription(results.join('\n')).setColor(0x00AE86).setTimestamp();
            await interaction.editReply({ embeds: [embed], ephemeral: true });
        } catch (err) {
            console.error('refill command error', err);
            const em = new EmbedBuilder().setTitle('Error').setDescription('There was an error performing the refill.').setColor(0xFF0000);
            await interaction.editReply({ embeds: [em], ephemeral: true });
        }
    }
};
