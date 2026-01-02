const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const uri = process.env.MONGODB_CONNECTIONSTRING;

if (!uri) {
    throw new Error('MONGODB_CONNECTIONSTRING is not set in .env');
}

const client = new MongoClient(uri);
let db = null;

async function connectToMongo(dbName = 'hilovidsSiteData'){
    if (!db) {
        await client.connect();
        db = client.db(dbName);
        console.log(`Connected to MongoDB: ${dbName}`);
    }
    return db;
}

function getDb(){
    if (!db) {
        throw new Error('MongoDB not connected. Call connectToMongo() first.');
    }
    return db;
}

module.exports = { connectToMongo, getDb };
