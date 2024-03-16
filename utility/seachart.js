function hasSundayPassedSince(datetimeString) {
    
    if(datetimeString == null) return true;

    // Convert datetime string to a Date object
    const datetime = new Date(datetimeString);
  
    // Get the day of the week of the datetime (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayOfWeek = datetime.getDay();
  
    // Calculate the difference in milliseconds between the datetime and the next Sunday
    const millisecondsInDay = 1000 * 60 * 60 * 24;
    const daysUntilNextSunday = (7 - dayOfWeek) % 7;
    const millisecondsUntilNextSunday = daysUntilNextSunday * millisecondsInDay;
  
    // Calculate the datetime of the next Sunday
    const nextSunday = new Date(datetime.getTime() + millisecondsUntilNextSunday);
  
    // Compare the datetime of the next Sunday with the current datetime
    return nextSunday < new Date();
}

function isValidGridSpace(str) {
    const regex = /^[A-Ja-j][0-9]$/;
    const regex2 = /^[0-9][A-Ja-j]$/;
  
    // Test if the string matches the pattern
    return regex.test(str) || regex2.test(str);
  }

module.exports = { hasSundayPassedSince, isValidGridSpace }