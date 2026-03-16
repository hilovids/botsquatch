#!/usr/bin/env node
/*
  Local badge utility (copy/paste friendly)

  Usage:
    node scripts/badgeTool.local.js --help
    node scripts/badgeTool.local.js add --username alice --badge umarble
    node scripts/badgeTool.local.js add --username alice --badge "umarble,thief"
    node scripts/badgeTool.local.js remove --username alice --badge nothing
    node scripts/badgeTool.local.js list --username alice

  Env vars (with defaults):
    MONGODB_CONNECTIONSTRING  (required unless --connection is provided)
    MONGODB_DBNAME            (default: hilovidsSiteData)
    BADGE_COLLECTION          (default: campers)
    BADGE_USERNAME_FIELD      (default: username)
*/

try { require('dotenv').config(); } catch (_) {}
const { MongoClient } = require('mongodb');
const { addBadges, removeBadges, listBadges } = require('../utils/badgeManager');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function printHelp() {
  console.log([
    'badgeTool.local.js',
    '',
    'Commands:',
    '  add --username <name> --badge <idOrName[,idOrName...]>',
    '  remove --username <name> --badge <idOrName[,idOrName...]>',
    '  list --username <name>',
    '',
    'Options:',
    '  --connection <mongodb-uri>',
    '  --db <dbName>',
    '  --collection <collectionName>',
    '  --userField <fieldName>',
    '  --help',
    '',
    'Examples:',
    '  node scripts/badgeTool.local.js add --username davis --badge umarble',
    '  node scripts/badgeTool.local.js add --username davis --badge "thief,nothing,curse"',
    '  node scripts/badgeTool.local.js remove --username davis --badge thief',
    '  node scripts/badgeTool.local.js list --username davis',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = String(args._[0] || '').toLowerCase();

  if (args.help || args.h || !command) {
    printHelp();
    process.exit(0);
  }

  if (!['add', 'remove', 'list'].includes(command)) {
    console.error('Unknown command:', command);
    printHelp();
    process.exit(1);
  }

  const username = args.username || args.user;
  if (!username) {
    console.error('Missing --username');
    process.exit(1);
  }

  const connectionString = args.connection || process.env.MONGODB_CONNECTIONSTRING;
  if (!connectionString) {
    console.error('Missing MongoDB connection string. Set MONGODB_CONNECTIONSTRING or pass --connection.');
    process.exit(1);
  }

  const dbName = args.db || process.env.MONGODB_DBNAME || 'hilovidsSiteData';
  const collectionName = args.collection || process.env.BADGE_COLLECTION || 'campers';
  const userField = args.userField || process.env.BADGE_USERNAME_FIELD || 'username';

  const client = new MongoClient(connectionString);

  try {
    await client.connect();
    const collection = client.db(dbName).collection(collectionName);
    const userQuery = { [userField]: username };

    if (command === 'list') {
      const result = await listBadges(collection, userQuery);
      if (!result.ok) {
        console.error('User not found:', username);
        process.exit(2);
      }
      console.log(JSON.stringify({ ok: true, username, badges: result.badges }, null, 2));
      process.exit(0);
    }

    const badgeArg = args.badge || args.badges;
    if (!badgeArg) {
      console.error('Missing --badge (single id/name or comma-separated list)');
      process.exit(1);
    }

    const result = command === 'add'
      ? await addBadges(collection, userQuery, badgeArg)
      : await removeBadges(collection, userQuery, badgeArg);

    if (result.reason === 'no-valid-badges') {
      console.error('No valid badges were provided.');
      console.error('Invalid values:', (result.invalidBadges || []).join(', '));
      process.exit(1);
    }

    if (result.reason === 'user-not-found' || result.matchedCount === 0) {
      console.error('User not found:', username);
      process.exit(2);
    }

    console.log(JSON.stringify({
      ok: true,
      command,
      username,
      appliedBadges: result.appliedBadges,
      invalidBadges: result.invalidBadges,
      modified: result.modified,
      badges: result.badges,
    }, null, 2));

    process.exit(0);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('badgeTool.local.js failed:', err && err.message ? err.message : err);
  process.exit(1);
});
