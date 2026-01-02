const { Events, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const { connectToMongo } = require('../utils/mongodbUtil');
const { ObjectId } = require('mongodb');
const Jimp = require('jimp');
const path = require('path');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		// Handle component interactions (buttons / selects) first
		try {
			// Vote button: customId => "vote:<camperId>"
			if (interaction.isButton()) {
				const cid = interaction.customId || '';
				// Alliance invite accept/decline: alliance_invite_accept:<channelId>:<recipientId>:<inviterId>:<ts>
				if (cid.startsWith('alliance_invite_accept:') || cid.startsWith('alliance_invite_decline:')) {
					await interaction.deferReply({ ephemeral: true });
					try {
						const parts = cid.split(':');
						const action = parts[0];
						const channelId = parts[1];
						const recipientId = parts[2];
						const inviterId = parts[3];
						const ts = Number(parts[4] || '0');
						const now = Date.now();
						const ttl = 24 * 60 * 60 * 1000; // 24h

						if (String(recipientId) !== String(interaction.user.id)) {
							await interaction.editReply({ content: 'You are not the recipient of this invite.', ephemeral: true });
							return;
						}

						if (ts <= 0 || (ts + ttl) < now) {
							await interaction.editReply({ content: 'This invite has expired.', ephemeral: true });
							return;
						}

						if (cid.startsWith('alliance_invite_decline:')) {
							// disable buttons on original message and delete it
							try {
								if (interaction.message && Array.isArray(interaction.message.components)) await interaction.message.edit({ components: interaction.message.components.map(r => ({ components: r.components.map(c => ({ ...c, disabled: true })) })) }).catch(() => {});
								if (interaction.message && interaction.message.deletable) await interaction.message.delete().catch(() => {});
							} catch (e) {}
							await interaction.editReply({ content: 'You declined the invite.', ephemeral: true });
							return;
						}

						// accept: give permissions in the alliance channel
						try {
							const chan = await interaction.client.channels.fetch(channelId).catch(() => null);
							if (chan) {
								await chan.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true }).catch(() => {});
							}
						} catch (e) { console.error('alliance accept permission error', e); }

						try {
							if (interaction.message && Array.isArray(interaction.message.components)) await interaction.message.edit({ components: interaction.message.components.map(r => ({ components: r.components.map(c => ({ ...c, disabled: true })) })) }).catch(() => {});
							if (interaction.message && interaction.message.deletable) await interaction.message.delete().catch(() => {});
						} catch (e) {}
						await interaction.editReply({ content: 'You joined the alliance.', ephemeral: true });
						return;
					} catch (err) {
						console.error('alliance invite button error', err);
						try { await interaction.editReply({ content: 'There was an error processing the invite.', ephemeral: true }); } catch (e) {}
						return;
					}
				}
				if (cid.startsWith('vote:')) {
					await interaction.deferReply({ ephemeral: true });
					try {
						const camperId = cid.split(':')[1];
						const db = await connectToMongo();
						const ceremonies = db.collection('ceremonies');
						const campersCol = db.collection('campers');

						const guildId = interaction.guildId;
						const ceremony = await ceremonies.findOne({ guildId, active: true });
						if (!ceremony) {
							await interaction.editReply({ content: 'No active ceremony to vote in.', ephemeral: true });
							return;
						}

						// ensure voter exists and is not cursed from voting
						const voter = await campersCol.findOne({ discordId: interaction.user.id });
						if (!voter) {
							await interaction.editReply({ content: 'Could not find your player record. You cannot vote.', ephemeral: true });
							return;
						}
						if (voter.curses && voter.curses.noVote) {
							await interaction.editReply({ content: 'You are cursed and cannot vote.', ephemeral: true });
							return;
						}

						if (ceremony.votes && ceremony.votes.some(v => v.voterId === interaction.user.id)) {
							await interaction.editReply({ content: 'You have already voted in this ceremony.', ephemeral: true });
							return;
						}

						let camper = null;
						try { camper = await campersCol.findOne({ _id: new ObjectId(camperId), eliminated: { $ne: true } }); } catch (e) { camper = null; }
						if (!camper) {
							await interaction.editReply({ content: 'That camper could not be found or is eliminated.', ephemeral: true });
							return;
						}

						if (ceremony.team && ceremony.team !== 'all' && camper.team !== ceremony.team) {
							await interaction.editReply({ content: 'That camper is not eligible in this vote.', ephemeral: true });
							return;
						}

						const vote = {
							voterId: interaction.user.id,
							voterName: interaction.user.tag,
							targetId: camper._id,
							targetName: camper.displayName || camper.username || camper.discordId,
							createdAt: new Date(),
							image: { contentType: null, data: null, size: null, filename: null }
						};

						// create default image for the vote (quick votes ignore attachments)
						try {
							const bgPath = path.join(__dirname, '..', 'assets', 'vote_board.png');
							const image = await Jimp.read(bgPath);
							const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
							const text = vote.targetName || camper.displayName || camper.username || camper.discordId;
							const w = image.bitmap.width;
							const h = image.bitmap.height;
							const textWidth = Jimp.measureText(font, text);
							const textHeight = Jimp.measureTextHeight(font, text, w);
							const x = Math.max(0, Math.floor((w - textWidth) / 2));
							const y = Math.max(0, Math.floor(h * 0.6 - textHeight / 2));
							image.print(font, x, y, {
								text: text,
								alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
								alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
							}, textWidth, textHeight);
							const mime = Jimp.MIME_PNG;
							const processedBuffer = await image.getBufferAsync(mime);
							vote.image.contentType = mime;
							vote.image.data = processedBuffer;
							vote.image.size = processedBuffer.length;
							const safeName = (text || 'vote').replace(/[^a-z0-9-_\.]/gi, '_');
							vote.image.filename = `${safeName}.png`;
						} catch (imgErr) {
							console.error('error creating default vote image', imgErr);
						}

						await ceremonies.updateOne({ _id: ceremony._id }, { $push: { votes: vote } });

						// disable components on the original message if present
						try {
							if (interaction.message && Array.isArray(interaction.message.components)) {
								const disabledRows = interaction.message.components.map(r => {
									const comps = r.components.map(c => {
										try { if (c.type === 2) return ButtonBuilder.from(c).setDisabled(true); } catch (e) {}
										try { return StringSelectMenuBuilder.from(c).setDisabled(true); } catch (e) {}
										return c;
									});
									return new ActionRowBuilder().addComponents(comps);
								});
								await interaction.message.edit({ components: disabledRows }).catch(() => {});
							}
						} catch (e) { console.error('disable components error', e); }

						await interaction.editReply({ content: `Your vote for **${vote.targetName}** has been recorded.`, ephemeral: true });
					} catch (err) {
						console.error('vote button error', err);
						try { await interaction.editReply({ content: 'There was an error recording your vote.', ephemeral: true }); } catch (e) { }
					}
					return;
				}
			}

			// Quick user-select: customId => "quick_vote_select:<team>"
			if (interaction.isAnySelectMenu && interaction.isAnySelectMenu()) {
				const cid = interaction.customId || '';
				// Alliance invite selector: alliance_invite_select:<channelId>:<ownerId>
				if (cid.startsWith('alliance_invite_select:')) {
					await interaction.deferReply({ ephemeral: true });
					try {
						const parts = cid.split(':');
						const allianceChannelId = parts[1];
						const ownerId = parts[2];
						const selected = Array.isArray(interaction.values) ? interaction.values : [];
						if (!selected || selected.length === 0) {
							await interaction.editReply({ content: 'No players selected.', ephemeral: true });
							return;
						}

						const db = await connectToMongo();
						const campersCol = db.collection('campers');
						const discordConfigs = db.collection('discordConfigs');
						const discordConfig = await discordConfigs.findOne({ server_id: interaction.guildId });

						// ensure only owner can use the selector
						if (String(ownerId) !== String(interaction.user.id)) {
							await interaction.editReply({ content: 'Only the alliance owner can invite members using this selector.', ephemeral: true });
							return;
						}

						// fetch inviter's camper record to check team
						const inviterCamper = await campersCol.findOne({ discordId: ownerId });
						if (!inviterCamper) {
							await interaction.editReply({ content: 'Could not find inviter camper record.', ephemeral: true });
							return;
						}

						const invitesToSend = [];
						const now = Date.now();
						const ttl = 24 * 60 * 60 * 1000; // 24 hours

						for (const uid of selected) {
							try {
								const camper = await campersCol.findOne({ discordId: uid, eliminated: { $ne: true } });
								if (!camper) continue;
								// enforce same team
								if (String(camper.team) !== String(inviterCamper.team)) continue;

								const ts = String(now);
								const acceptId = `alliance_invite_accept:${allianceChannelId}:${uid}:${ownerId}:${ts}`;
								const declineId = `alliance_invite_decline:${allianceChannelId}:${uid}:${ownerId}:${ts}`;

								invitesToSend.push({ uid, acceptId, declineId, ts });
							} catch (e) { console.error('alliance select iterate error', e); }
						}

						if (invitesToSend.length === 0) {
							await interaction.editReply({ content: 'No valid players to invite (must be same team and not eliminated).', ephemeral: true });
							return;
						}

						// send invite embed to each recipient's confessional or DM, pinging them
						for (const inv of invitesToSend) {
							try {
								const recipient = await campersCol.findOne({ discordId: inv.uid }).catch(() => null);
								const inviteEmbed = new EmbedBuilder()
									.setTitle(`Alliance Invite`)
									.setDescription((interaction.message && interaction.message.embeds && interaction.message.embeds[0] && interaction.message.embeds[0].description) || '')
									.addFields({ name: 'Invited By', value: `${interaction.user.username}` })
									.setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0x00AE86)
									.setTimestamp();

								const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
								const row = new ActionRowBuilder().addComponents(
									new ButtonBuilder().setCustomId(inv.acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
									new ButtonBuilder().setCustomId(inv.declineId).setLabel('Decline').setStyle(ButtonStyle.Danger)
								);

								// include a mention to ping
								const pingContent = `<@${inv.uid}>`;

								if (recipient && recipient.confessionalId) {
									const chan = await interaction.client.channels.fetch(recipient.confessionalId).catch(() => null);
									if (chan) await chan.send({ content: pingContent, embeds: [inviteEmbed], components: [row] }).catch(() => null);
								} else {
									const userObj = await interaction.client.users.fetch(inv.uid).catch(() => null);
									if (userObj) await userObj.send({ content: pingContent, embeds: [inviteEmbed], components: [row] }).catch(() => null);
								}
							} catch (e) { console.error('send alliance invite error', e); }
						}

						// disable selector components on original message
						try {
							if (interaction.message && Array.isArray(interaction.message.components)) {
								const disabledRows = interaction.message.components.map(r => {
									const comps = r.components.map(c => {
										try { return StringSelectMenuBuilder.from(c).setDisabled(true); } catch (e) {}
										return c;
									});
									return new ActionRowBuilder().addComponents(comps);
								});
								await interaction.message.edit({ components: disabledRows }).catch(() => {});
							}
						} catch (e) { console.error('disable selector error', e); }

						await interaction.editReply({ content: `Sent ${invitesToSend.length} invite(s).`, ephemeral: true });
						return;
					} catch (err) {
						console.error('alliance invite select error', err);
						try { await interaction.editReply({ content: 'There was an error sending invites.', ephemeral: true }); } catch (e) {}
						return;
					}
				}
				if (cid.startsWith('quick_vote_select:')) {
					await interaction.deferReply({ ephemeral: true });
					try {
						const team = cid.split(':')[1] || 'all';
						const selected = Array.isArray(interaction.values) ? interaction.values[0] : null;
						if (!selected) {
							await interaction.editReply({ content: 'No selection made.', ephemeral: true });
							return;
						}

						const db = await connectToMongo();
						const ceremonies = db.collection('ceremonies');
						const campersCol = db.collection('campers');

						const guildId = interaction.guildId;
						const ceremony = await ceremonies.findOne({ guildId, active: true });
						if (!ceremony) {
							await interaction.editReply({ content: 'No active ceremony to vote in.', ephemeral: true });
							return;
						}

						// ensure voter exists and is not cursed from voting
						const voter = await campersCol.findOne({ discordId: interaction.user.id });
						if (!voter) {
							await interaction.editReply({ content: 'Could not find your player record. You cannot vote.', ephemeral: true });
							return;
						}
						if (voter.curses && voter.curses.noVote) {
							await interaction.editReply({ content: 'You are cursed and cannot vote.', ephemeral: true });
							return;
						}

						if (ceremony.votes && ceremony.votes.some(v => v.voterId === interaction.user.id)) {
							await interaction.editReply({ content: 'You have already voted in this ceremony.', ephemeral: true });
							return;
						}

						// selected is a user ID from the select menu
						const targetDiscordId = selected;
						const camper = await campersCol.findOne({ discordId: targetDiscordId, eliminated: { $ne: true } });
						if (!camper) {
							await interaction.editReply({ content: 'Selected member is not a valid camper for voting.', ephemeral: true });
							return;
						}

						if (team !== 'all' && camper.team !== team) {
							await interaction.editReply({ content: 'Selected member is not eligible for this vote.', ephemeral: true });
							return;
						}

						const vote = {
							voterId: interaction.user.id,
							voterName: interaction.user.tag,
							targetId: camper._id,
							targetName: camper.displayName || camper.username || camper.discordId,
							createdAt: new Date(),
							image: { contentType: null, data: null, size: null, filename: null }
						};

						// create default image for the quick vote
						try {
							const bgPath = path.join(__dirname, '..', 'assets', 'vote_board.png');
							const image = await Jimp.read(bgPath);
							const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
							const text = vote.targetName || camper.displayName || camper.username || camper.discordId;
							const w = image.bitmap.width;
							const h = image.bitmap.height;
							const textWidth = Jimp.measureText(font, text);
							const textHeight = Jimp.measureTextHeight(font, text, w);
							const x = Math.max(0, Math.floor((w - textWidth) / 2));
							const y = Math.max(0, Math.floor((h * 0.4) - textHeight / 2));
							image.print(font, x, y, {
								text: text,
								alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
								alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
							}, textWidth, textHeight);
							const mime = Jimp.MIME_PNG;
							const processedBuffer = await image.getBufferAsync(mime);
							vote.image.contentType = mime;
							vote.image.data = processedBuffer;
							vote.image.size = processedBuffer.length;
							const safeName = (text || 'vote').replace(/[^a-z0-9-_\.]/gi, '_');
							vote.image.filename = `${safeName}.png`;
						} catch (imgErr) {
							console.error('error creating default vote image', imgErr);
						}

						await ceremonies.updateOne({ _id: ceremony._id }, { $push: { votes: vote } });

						// disable components on the original message if present
						try {
							if (interaction.message && Array.isArray(interaction.message.components)) {
								const disabledRows = interaction.message.components.map(r => {
									const comps = r.components.map(c => {
										try { if (c.type === 2) return ButtonBuilder.from(c).setDisabled(true); } catch (e) {}
										try { return StringSelectMenuBuilder.from(c).setDisabled(true); } catch (e) {}
										return c;
									});
									return new ActionRowBuilder().addComponents(comps);
								});
								await interaction.message.edit({ components: disabledRows }).catch(() => {});
							}
						} catch (e) { console.error('disable components error', e); }

						await interaction.editReply({ content: `Your quick vote for **${vote.targetName}** has been recorded.`, ephemeral: true });
					} catch (err) {
						console.error('quick vote select error', err);
						try { await interaction.editReply({ content: 'There was an error recording your quick vote.', ephemeral: true }); } catch (e) { }
					}
					return;
				}
			}
		} catch (compErr) {
			console.error('component interaction handler error', compErr);
			try { if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Interaction error.', ephemeral: true }); } catch (e) { }
			return;
		}

		// Handle modal submits (eg. egg token target)
		if (interaction.isModalSubmit && interaction.isModalSubmit()) {
			if (interaction.customId === 'token_egg_modal') {
				await interaction.deferReply({ ephemeral: true });
				try {
					const targetText = interaction.fields.getTextInputValue('egg_target');
					const db = await connectToMongo();
					const campersCol = db.collection('campers');
					const ceremonies = db.collection('ceremonies');
					const discordConfigs = db.collection('discordConfigs');
					const discordConfig = await discordConfigs.findOne({ server_id: interaction.guildId });

					const voter = await campersCol.findOne({ discordId: interaction.user.id });
					if (!voter) {
						await interaction.editReply({ content: 'Could not find your player record.', ephemeral: true });
						return;
					}

					const available = (voter.inventory && voter.inventory.eggToken) ? voter.inventory.eggToken : 0;
					if (available <= 0) {
						await interaction.editReply({ content: 'You do not have any egg tokens to use.', ephemeral: true });
						return;
					}

					const ceremony = await ceremonies.findOne({ guildId: interaction.guildId, active: true });
					if (!ceremony) {
						await interaction.editReply({ content: 'No active ceremony to use an egg token in.', ephemeral: true });
						return;
					}

					function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'); }

					const exactRegex = new RegExp('^' + escapeRegExp(targetText) + '$', 'i');
					let matches = await campersCol.find({ eliminated: { $ne: true }, $or: [ { displayName: exactRegex }, { username: exactRegex }, { discordId: targetText } ] }).toArray();
					let target = null;
					if (matches.length === 0) {
						const partial = await campersCol.find({ eliminated: { $ne: true }, $or: [ { displayName: new RegExp(escapeRegExp(targetText), 'i') }, { username: new RegExp(escapeRegExp(targetText), 'i') } ] }).toArray();
						if (partial.length === 1) target = partial[0];
						else if (partial.length > 1) {
							await interaction.editReply({ content: `Multiple campers matched "${targetText}". Please be more specific.`, ephemeral: true });
							return;
						}
					} else if (matches.length === 1) target = matches[0];
					else {
						await interaction.editReply({ content: `Multiple campers matched "${targetText}". Please be more specific.`, ephemeral: true });
						return;
					}

					if (!target) {
						await interaction.editReply({ content: `No camper matched "${targetText}".`, ephemeral: true });
						return;
					}

					// prevent targeting self with egg token
					if ((target.discordId && String(target.discordId) === String(interaction.user.id)) || (voter && target._id && voter._id && String(target._id) === String(voter._id))) {
						await interaction.editReply({ content: 'You cannot target yourself with an egg token.', ephemeral: true });
						return;
					}

					// record egg usage in ceremony.tokens
					await ceremonies.updateOne({ _id: ceremony._id }, { $push: { tokens: { type: 'egg', userId: interaction.user.id, targetId: target._id, createdAt: new Date() } } }, { upsert: true });

					// decrement token
					await campersCol.updateOne({ _id: voter._id }, { $inc: { 'inventory.eggToken': -1 } });

					// send anonymous embed to campground
					try {
						const embed = new EmbedBuilder().setTitle('A token has been used!').setColor(discordConfig && discordConfig.embed && discordConfig.embed.color ? discordConfig.embed.color : 0xFEB316);
						const campId = discordConfig && discordConfig.campground_id;
						if (campId) {
							const chan = await interaction.client.channels.fetch(campId).catch(() => null);
							if (chan) await chan.send({ embeds: [embed] });
						}
					} catch (e) { console.error('egg token embed send error', e); }

					const updated = await campersCol.findOne({ _id: voter._id });
					const remaining = (updated.inventory && updated.inventory.eggToken) ? updated.inventory.eggToken : 0;
					await interaction.editReply({ content: `Egg token used on ${target.displayName || target.username || target.discordId}. You have ${remaining} remaining.`, ephemeral: true });
				} catch (err) {
					console.error('egg modal submit error', err);
					try { await interaction.editReply({ content: 'There was an error processing your egg token.', ephemeral: true }); } catch (e) {}
				}
				return;
			}
		}

		// Fallback: continue handling chat input commands
		if (!interaction.isChatInputCommand()) return;

		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		try {
			await command.execute(interaction);
		} catch (error) {
			console.error(error);
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
			} else {
				await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
			}
		}
	},
};