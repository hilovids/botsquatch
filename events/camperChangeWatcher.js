const { connectToMongo } = require('../utils/mongodbUtil');
const { buildEmbedFromChange } = require('../utils/notifyEmbed');

let watcherStarted = false;

async function startWatcher(client) {
    // if (watcherStarted) return;
    // watcherStarted = true;

    // try {
    //     const db = await connectToMongo();
    //     const campers = db.collection('campers');
    //     const changeStream = campers.watch([], { fullDocument: 'updateLookup' });

    //     console.log('Camper change watcher started.');

    //     changeStream.on('change', async (change) => {
    //         try {
    //             if (!change) return;
    //             if (change.operationType !== 'update' && change.operationType !== 'replace' && change.operationType !== 'insert') return;

    //             const fullDoc = change.fullDocument;
    //             const updateDesc = change.updateDescription || {};

    //             if (!fullDoc) return;

    //             const confId = fullDoc.confessionalId;
    //             if (!confId) return;

    //             const { embeds, files } = await buildEmbedFromChange(change, fullDoc, updateDesc, null);
    //             if (!embeds || embeds.length === 0) return;

    //             try {
    //                 const chan = await client.channels.fetch(confId).catch(() => null);
    //                 if (!chan) return;
    //                 for (let i = 0; i < embeds.length; i++) {
    //                     const emb = embeds[i];
    //                     const f = files && files[i] ? files[i] : undefined;
    //                     if (f) await chan.send({ embeds: [emb], files: [f] }).catch(() => {});
    //                     else await chan.send({ embeds: [emb] }).catch(() => {});
    //                 }
    //             } catch (e) {
    //                 console.error('error sending camper notification', e);
    //             }

    //         } catch (e) { console.error('error handling camper change', e); }
    //     });

    //     changeStream.on('error', (e) => { console.error('camper change stream error', e); });

    // } catch (e) {
    //     console.error('failed to start camper change watcher', e);
    // }
}

module.exports = { startWatcher };
