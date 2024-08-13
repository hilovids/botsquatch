const axios = require('axios');
const { league_api, brooks_puuid } = require('../config.json');

async function getRankedData() {
    try {
        const url = `https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${brooks_puuid}?api_key=${league_api}`;
        const response = await axios.get(url);
        const summonerId = response.data.id;

        const rankedUrl = `https://na1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}?api_key=${league_api}`;
        const rankedResponse = await axios.get(rankedUrl);
        const data = rankedResponse.data;

        // console.log('Ranked Data:', data[0]);
        return data[0];
    } catch (error) {
        console.error('Error fetching Summoner data:', error.response ? error.response.data : error.message);
        throw error;
    }
}

module.exports = { getRankedData }