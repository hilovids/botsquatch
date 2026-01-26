// Simple in-memory busy tracker for users to prevent concurrent commands
const BUSY = new Map();

function setBusy(userId, reason = 'busy', timeoutMs = null) {
    BUSY.set(String(userId), { reason: reason || 'busy', until: timeoutMs ? Date.now() + timeoutMs : null });
    if (timeoutMs && timeoutMs > 0) {
        setTimeout(() => {
            const entry = BUSY.get(String(userId));
            if (entry && entry.until && Date.now() >= entry.until) BUSY.delete(String(userId));
        }, timeoutMs + 50);
    }
}

function isBusy(userId) {
    const entry = BUSY.get(String(userId));
    if (!entry) return false;
    if (entry.until && Date.now() >= entry.until) {
        BUSY.delete(String(userId));
        return false;
    }
    return true;
}

function getReason(userId) {
    const entry = BUSY.get(String(userId));
    return entry ? entry.reason : null;
}

function clearBusy(userId) {
    BUSY.delete(String(userId));
}

module.exports = { setBusy, isBusy, getReason, clearBusy };
