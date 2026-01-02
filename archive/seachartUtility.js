const { seachart_hits } = require('../config.json');


function hasSundayPassedSince(datetimeInt) {
    
    if(datetimeInt == null) return true;

    const datetime = new Date(datetimeInt);
  
    const dayOfWeek = datetime.getDay();

    const millisecondsInDay = 1000 * 60 * 60 * 24;
    const daysUntilNextSunday = (7 - dayOfWeek);
    const millisecondsUntilNextSunday = daysUntilNextSunday * millisecondsInDay;
  
    // Calculate the datetime of the next Sunday
    const nextSunday = new Date(datetime.getTime() + millisecondsUntilNextSunday);
    nextSunday.setUTCHours(0,0,0,0)
    return nextSunday < new Date();
}

function isValidGridSpace(str) {
    const regex = /^[A-Ja-j][0-9]$/;
    return regex.test(str);
}

function distanceBetweenSpaces(sp1, sp2){

    const columns = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const rows = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    return Math.max(Math.abs(columns.indexOf(sp1[0]) - columns.indexOf(sp2[0])), Math.abs(rows.indexOf(sp1[1]) - rows.indexOf(sp2[1])));
}

function dredgeResult(space){
    const caps = space.toUpperCase();
    return seachart_hits.includes(caps);
}

function scanResult(space){
    const spacelower = space.toLowerCase();

    const column = spacelower.charAt(0);
    const row = spacelower.charAt(1);

    // Define the adjacent spaces, including diagonals
    const adjacentSpaces = [
        column + (parseInt(row) - 1), // Above
        column + (parseInt(row) + 1), // Below
        String.fromCharCode(column.charCodeAt(0) - 1) + row, // Left
        String.fromCharCode(column.charCodeAt(0) + 1) + row, // Right
        String.fromCharCode(column.charCodeAt(0) - 1) + (parseInt(row) - 1), // Upper left diagonal
        String.fromCharCode(column.charCodeAt(0) + 1) + (parseInt(row) - 1), // Upper right diagonal
        String.fromCharCode(column.charCodeAt(0) - 1) + (parseInt(row) + 1), // Lower left diagonal
        String.fromCharCode(column.charCodeAt(0) + 1) + (parseInt(row) + 1), // Lower right diagonal
    ];

    let count = 0;
    //console.log(adjacentSpaces);
    adjacentSpaces.forEach(adjacentSpace => {
        if (seachart_hits.includes(adjacentSpace.toUpperCase())) {
            count++;
        }
    });

    let numEmoji = ""
    switch(count){
        case 1:
            numEmoji = "1️⃣"
            break;
        case 2:
            numEmoji = "2️⃣"
            break;
        case 3:
            numEmoji = "3️⃣"
            break;
        case 4:
            numEmoji = "4️⃣"
            break;
        case 5:
            numEmoji = "5️⃣"
            break;
        case 6:
            numEmoji = "6️⃣"
            break;
        case 7:
            numEmoji = "7️⃣"
            break;
        case 8:
            numEmoji = "8️⃣"
            break;
        default:
            numEmoji = "0️⃣"
            break;
    }

    let text = `⬜⬜⬜\n⬜${numEmoji}⬜\n⬜⬜⬜\nThere are ${count} artifacts around the space ${space}.`
    return text
}

function getGriddy(space) {
    const spacelower = space.toLowerCase();
    const columns = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const rows = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

    let grid = '🌟🇦 🇧 🇨 🇩 🇪 🇫 🇬 🇭 🇮 🇯\n';
    for (let i = 0; i < rows.length; i++) {
        let numEmoji = ""
        switch(i){
            case 0:
                numEmoji = "0️⃣"
                break;
            case 1:
                numEmoji = "1️⃣"
                break;
            case 2:
                numEmoji = "2️⃣"
                break;
            case 3:
                numEmoji = "3️⃣"
                break;
            case 4:
                numEmoji = "4️⃣"
                break;
            case 5:
                numEmoji = "5️⃣"
                break;
            case 6:
                numEmoji = "6️⃣"
                break;
            case 7:
                numEmoji = "7️⃣"
                break;
            case 8:
                numEmoji = "8️⃣"
                break;
            case 9:
                numEmoji = "9️⃣"
                break;
        }
        grid += numEmoji
        for (let j = 0; j < columns.length; j++) {
            const currentSpace = columns[j] + rows[i];
            switch (currentSpace){
                case "a0":
                    cellContent = '🗿'
                    break;
                case "a9":
                    cellContent = '🔥'
                    break;
                case "j0":
                    cellContent = '🌊'
                    break;
                case "j9":
                    cellContent = '🌬️'
                    break;
                case spacelower:
                    cellContent = '⛵'
                    break;
                default:
                    cellContent = '🟦'
            }
            grid += cellContent + ' ';
        }
      grid += '\n';
    }
    grid +=`You are currently on ${space}.`
    return grid;
  }

  function getList(userData){
    let text = '';
    userData.forEach(element => {
        text += `${element.preferred_name} - ${element.seachart_loc}\n`
    });
    return text;
  }

module.exports = { hasSundayPassedSince, isValidGridSpace, distanceBetweenSpaces, dredgeResult, scanResult, getGriddy, getList }