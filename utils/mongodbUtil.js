const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const uri = process.env.MONGODB_CONNECTIONSTRING;

if (!uri) {
    throw new Error('MONGODB_CONNECTIONSTRING is not set in .env');
}

const client = new MongoClient(uri, {
    tls: true, // Ensure TLS is enabled
    tlsInsecure: false, // Reject invalid certificates
    serverSelectionTimeoutMS: 10000, // Timeout after 10 seconds
});

let db = null;

async function connectToMongo(dbName = 'hilovidsSiteData') {
    if (!db) {
        try {
            await client.connect();
            db = client.db(dbName);
            console.log(`Connected to MongoDB: ${dbName}`);
        } catch (err) {
            console.error('Failed to connect to MongoDB:', err);
            throw err;
        }
    }
    return db;
}

function getDb() {
    if (!db) {
        throw new Error('MongoDB not connected. Call connectToMongo() first.');
    }
    return db;
}

module.exports = { connectToMongo, getDb };
