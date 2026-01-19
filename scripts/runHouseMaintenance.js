const path = require('path');
(async () => {
  try {
    // ensure we require the project's utils path
    const hm = require(path.join(__dirname, '..', 'utils', 'houseManager'));
    if (!hm || typeof hm.performWeeklyMaintenance !== 'function') {
      console.error('houseManager.performWeeklyMaintenance not found');
      process.exit(1);
    }
    console.log('Running performWeeklyMaintenance()...');
    const res = await hm.performWeeklyMaintenance();
    console.log('performWeeklyMaintenance result:', JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('performWeeklyMaintenance failed:', err);
    process.exit(1);
  }
})();
