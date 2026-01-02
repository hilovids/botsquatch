const { Events } = require('discord.js');
const { startWatcher } = require('./camperChangeWatcher');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
		// start the camper change watcher to notify players about awards
		try { await startWatcher(client); } catch (e) { console.error('failed to start camper watcher on ready', e); }
	},
};