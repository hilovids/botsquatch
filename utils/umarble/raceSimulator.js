// Standalone race simulator utilities
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
const STAT_MAX = 12;

const DEFAULT_WEATHERS = ['sunny', 'rainy', 'snowy'];
const WEATHER_MODIFIERS = {
    sunny: { Agility: 1.15, Brawn: 0.95, Endurance: 0.95 },
    rainy: { Agility: 0.90, Brawn: 1.12, Endurance: 1.00 },
    snowy: { Agility: 0.85, Brawn: 1.00, Endurance: 1.15 }
};

const EVENT_TEMPLATES = {
    resolve: [
        '%s surged with Resolve (+%s m)',
        '%s rallied and gained +%s m from Resolve',
        '%s made a comeback (+%s m)'
    ],
    bump: [
        '%s bumped %s (force %s)',
        '%s shoved past %s (force %s)'
    ],
    bumpFail: [
        '%s tried to bump and lost %s m',
        '%s failed a bump attempt (-%s m)'
    ],
    obstacle: [
        '%s hit %s and lost %s m',
        '%s was slowed at %s (-%s m)'
    ],
    speedBurst: ['%s used Speed Burst (+%s m)'],
    staminaBuff: ['%s used Stamina Buff (+%s m)'],
    debuffSpeed: ['%s used Debuff — reduced others by ≈ %s m/tick'],
    finish: ['%s finished (t=%s)']
};

function _fmt(random, templateKey, ...args) {
    const t = EVENT_TEMPLATES[templateKey] || ['%s'];
    const pick = t[Math.floor(random() * t.length)];
    let out = pick;
    args.forEach(a => { out = out.replace('%s', a); });
    return out;
}

function _skillChance(stats, stage, stages) {
    const base = 0.05 + (stats.Mind / STAT_MAX) * 0.6 + (stats.Luck / STAT_MAX) * 0.15;
    const stageFactor = 0.25 + 0.75 * (stage / Math.max(1, stages));
    const enduranceFactor = 0.6 + 0.8 * (stats.Endurance / STAT_MAX);
    return clamp(base * stageFactor * enduranceFactor, 0.03, 0.95);
}

function _topSpeed(stats, weather) {
    const wm = WEATHER_MODIFIERS[weather] || {};
    const a = (stats.Agility || 0) * (wm.Agility || 1);
    const b = (stats.Brawn || 0) * (wm.Brawn || 1);
    const e = (stats.Endurance || 0) * (wm.Endurance || 1);
    return 3 + a * 3 + b * 1.2 + e * 0.9 + (stats.Luck || 0) * 0.3;
}

// Main exported function. Inputs:
// - racers: array of { name, stats: {Agility,Brawn,Endurance,Mind,Luck,Resolve}, skills: {...}, skillTiming }
// - options: { stages, trackLength, obstacles, ticksPerStage, random, weather }
// Returns: { stages, final, positionsHistory }
function runRaceSimulation(racersInput = [], options = {}) {
    const random = options.random || Math.random;
    const stagesCap = options.stages || 500;
    const trackLength = options.trackLength || 1000;
    const obstacles = options.obstacles || [];
    const ticksPerStage = options.ticksPerStage || 10;
    const weathers = DEFAULT_WEATHERS;
    const weather = options.weather || weathers[Math.floor(random() * weathers.length)];

    // clone racers and attach internal state
    const racers = racersInput.map((r, i) => ({
        ...r,
        _protected: false,
        pos: (typeof r.pos === 'number') ? r.pos : (random() * 2 * i * 0.01),
        speed: 0,
        _usedSkill: false,
        _obsCooldown: 0,
        _lastObstacle: null,
        _bumpCooldown: 0,
        _resolveCooldown: 0,
        finished: false
    }));

    const stages = [];
    const positionsHistory = {};
    for (const r of racers) positionsHistory[r.name] = [];

    const cumulative = racers.map(r => ({ name: r.name, total: 0 }));

    let stageEvents = [];
    for (let tick = 1; tick <= stagesCap; tick++) {
        const tickEvents = [];
        const leaderPos = Math.max(...racers.map(r => r.pos));

        // per-racer updates
        for (const racer of racers) {
            const s = racer.stats || {};
            const top = _topSpeed(s, weather);
            const checkFactor = clamp(1 - (tick / stagesCap) * (1 - (s.Endurance || 0) / STAT_MAX), 0.25, 1);
            const desired = top * (0.55 + 0.45 * random());
            const baseSkillChance = _skillChance(s, tick, stagesCap) * checkFactor;
            const stageNorm = tick / Math.max(1, stagesCap);
            const timing = (typeof racer.skillTiming === 'number') ? clamp(racer.skillTiming, 0, 1) : 0.5;
            const timingFactor = 0.2 + 0.8 * Math.pow(stageNorm, 1 + timing * 3);
            const skillChance = baseSkillChance * timingFactor;

            if (!racer._usedSkill && racer.skills && racer.skills.speedBurst && random() < skillChance) {
                const burst = 3 + (s.Agility || 0) * 1.2 + random() * 2;
                racer.speed = Math.max(racer.speed || desired, top + burst);
                tickEvents.push({ msg: _fmt(random, 'speedBurst', racer.name, burst.toFixed(1)), mag: burst, type: 'speedBurst' });
                racer._usedSkill = true;
            }

            if (!racer._usedSkill && racer.skills && racer.skills.staminaBuff && random() < skillChance) {
                const buff = 2 + (s.Endurance || 0) * 1.0;
                racer.speed = Math.max(racer.speed || desired, Math.min(top + buff, (racer.speed || desired) + buff));
                racer._protected = Math.max(racer._protected, Math.round(1 + (s.Endurance || 0)));
                tickEvents.push({ msg: _fmt(random, 'staminaBuff', racer.name, buff.toFixed(1)) + ` (protected for ${racer._protected} ticks)`, mag: buff, type: 'staminaBuff' });
                racer._usedSkill = true;
            }

            if (!racer._usedSkill && racer.skills && racer.skills.debuff && random() < skillChance) {
                const others = racers.filter(x => x.name !== racer.name);
                if (others.length) {
                    const baseAmount = 1 + (s.Brawn || 0) * 0.4 + random() * 1.0;
                    let applied = 0;
                    for (const target of others) {
                        const targetTop = _topSpeed(target.stats || {}, weather);
                        const targetDesired = targetTop * (0.55 + 0.45 * random());
                        const before = (target.speed || targetDesired);
                        const newSpeed = Math.max(0, before - baseAmount);
                        target.speed = newSpeed;
                        applied += (before - newSpeed);
                    }
                    const avgApplied = applied / others.length;
                    tickEvents.push({ msg: _fmt(random, 'debuffSpeed', racer.name, avgApplied.toFixed(1)), mag: avgApplied, type: 'debuffSpeed' });
                    racer._usedSkill = true;
                }
            }

            const behindBy = leaderPos - racer.pos;
            if (behindBy > trackLength * 0.06 && tick > stagesCap * 0.3) {
                let comebackChance = clamp(((s.Resolve || 0) / STAT_MAX) * 0.25 + (random() * 0.05), 0, 0.9) * checkFactor;
                if (racer._resolveCooldown && racer._resolveCooldown > 0) comebackChance *= 0.2;
                if (random() < comebackChance) {
                    const surge = 1.5 + (s.Resolve || 0) * 1.5 + random() * 3;
                    racer.speed = (racer.speed || desired) + surge;
                    if (surge >= 2.5) {
                        tickEvents.push({ msg: _fmt(random, 'resolve', racer.name, surge.toFixed(1)), mag: surge, type: 'resolve' });
                        racer._resolveCooldown = 4;
                    }
                }
            }

            if (!racer.speed || racer.speed < 0.2) {
                racer.speed = (racer.speed || 0) * 0.6 + desired * 0.4;
                if (racer.speed < 0.5) racer.speed = Math.min(0.5, desired);
            }
        }

        // Apply bumps
        const byPos = [...racers].sort((a, b) => b.pos - a.pos);
        for (let i = 0; i < byPos.length - 1; i++) {
            const lead = byPos[i];
            const follow = byPos[i + 1];
            if ((lead._bumpCooldown && lead._bumpCooldown > 0) || (follow._bumpCooldown && follow._bumpCooldown > 0)) continue;
            const leadNext = lead.pos + (lead.speed || 0);
            const followNext = follow.pos + (follow.speed || 0);
            const willOverlap = followNext >= lead.pos - 0.5 && followNext <= leadNext + 1;
            if (willOverlap) {
                const wm = WEATHER_MODIFIERS[weather] || {};
                const bFollow = (follow.stats && follow.stats.Brawn || 0) * (wm.Brawn || 1);
                const bLead = (lead.stats && lead.stats.Brawn || 0) * (wm.Brawn || 1);
                const brawnDiff = bFollow - bLead;
                const speedDiff = (follow.speed || 0) - (lead.speed || 0);
                let force = clamp(brawnDiff * 1.8 + speedDiff * 0.2 + (random() - 0.5) * 2, -6, 12);
                if (force > 0.8) {
                    const push = force * (1 + Math.abs(brawnDiff) * 0.1);
                    lead.speed = Math.max(0, (lead.speed || 0) - push);
                    follow.speed += push * 0.35;
                    if (push >= 0.8) tickEvents.push({ msg: _fmt(random, 'bump', follow.name, lead.name, push.toFixed(1)), mag: push, type: 'bump' });
                    follow._bumpCooldown = 3;
                    lead._bumpCooldown = 1;
                } else if (force < -0.8) {
                    const loss = Math.abs(force) * 0.6;
                    follow.speed = Math.max(0, (follow.speed || 0) - loss);
                    if (loss >= 1.5) tickEvents.push({ msg: _fmt(random, 'bumpFail', follow.name, loss.toFixed(1)), mag: loss, type: 'bumpFail' });
                    follow._bumpCooldown = 3;
                }
            }
        }

        // Move racers and handle obstacles
        const crossEvents = [];
        for (const racer of racers) {
            if (racer.finished) continue;
            const prev = racer.pos;
            racer.pos = racer.pos + (racer.speed || 0);

            for (const obs of obstacles) {
                if (racer._obsCooldown && racer._obsCooldown > 0) continue;
                if (prev < obs.pos && racer.pos >= obs.pos) {
                    if (obs.type === 'pit') {
                        const wm = WEATHER_MODIFIERS[weather] || {};
                        const effEnd = (racer.stats.Endurance || 0) * (wm.Endurance || 1);
                        const loss = 3 + (STAT_MAX - effEnd) * 1.0 + random() * 2.5;
                        racer.pos = Math.max(0, racer.pos - loss);
                        tickEvents.push({ msg: _fmt(random, 'obstacle', racer.name, obs.name, loss.toFixed(1)), mag: loss, type: 'obstacle' });
                        racer._obsCooldown = 3;
                        racer._lastObstacle = obs.pos;
                    } else if (obs.type === 'narrow') {
                        const wm = WEATHER_MODIFIERS[weather] || {};
                        const effA = (racer.stats.Agility || 0) * (wm.Agility || 1);
                        const slow = 1.5 + random() * 2.5 - effA * 0.25;
                        racer.speed = Math.max(0, (racer.speed || 0) - slow);
                        tickEvents.push({ msg: _fmt(random, 'obstacle', racer.name, obs.name, slow.toFixed(1)), mag: slow, type: 'obstacle' });
                        racer._obsCooldown = 2;
                        racer._lastObstacle = obs.pos;
                    } else if (obs.type === 'boost') {
                        const wm = WEATHER_MODIFIERS[weather] || {};
                        const effA = (racer.stats.Agility || 0) * (wm.Agility || 1);
                        const gain = 2 + effA * 0.5 + random() * 1.5;
                        racer.pos = Math.min(trackLength, racer.pos + gain);
                        tickEvents.push({ msg: _fmt(random, 'obstacle', racer.name, obs.name, gain.toFixed(1)), mag: gain, type: 'obstacle' });
                        racer._obsCooldown = 2;
                        racer._lastObstacle = obs.pos;
                    }
                }
            }

            const troubleBase = 0.04;
            const wm = WEATHER_MODIFIERS[weather] || {};
            const effEndurance = (racer.stats.Endurance || 0) * (wm.Endurance || 1);
            const troubleProb = clamp(troubleBase * (1 - effEndurance / STAT_MAX) * (1 - tick / stagesCap) + (0.008 * (1 - (racer.stats.Mind || 0) / STAT_MAX)), 0.002, 0.35);
            if (random() < troubleProb) {
                const setback = 1 + random() * 3 - (racer.stats.Endurance || 0) * 0.4;
                racer.pos = Math.max(0, racer.pos - setback);
                tickEvents.push({ msg: `${racer.name} encountered trouble (-${setback.toFixed(1)} m)`, mag: setback, type: 'trouble' });
            }

            if (racer.pos >= trackLength) {
                racer.pos = trackLength;
                racer.finished = true;
                racer.finishedAt = tick;
                tickEvents.push({ msg: _fmt(random, 'finish', racer.name, tick), mag: 9999, type: 'finish' });
            }

            const c = cumulative.find(x => x.name === racer.name);
            c.total = racer.pos;

            racer.speed = Math.max(0, (racer.speed || 0) * 0.85);
            if (!racer.finished && racer.speed > 0 && racer.speed < 0.05) racer.speed = 0.05;
            if (racer._protected) racer._protected = Math.max(0, racer._protected - 1);
            if (racer._obsCooldown && racer._obsCooldown > 0) racer._obsCooldown = Math.max(0, racer._obsCooldown - 1);
            if (racer._bumpCooldown && racer._bumpCooldown > 0) racer._bumpCooldown = Math.max(0, racer._bumpCooldown - 1);
            if (racer._resolveCooldown && racer._resolveCooldown > 0) racer._resolveCooldown = Math.max(0, racer._resolveCooldown - 1);
            if (racer._lastObstacle && racer.pos > racer._lastObstacle + 5) racer._lastObstacle = null;

            const prevStage = Math.floor(prev / 100);
            const newStage = Math.floor(racer.pos / 100);
            if (newStage > prevStage) {
                const capped = Math.min(newStage + 1, Math.ceil(trackLength / 100));
                crossEvents.push({ name: racer.name, newStage: capped, pos: racer.pos });
            }
        }

        if (crossEvents.length) {
            const ordered = racers.map(r => ({ name: r.name, pos: r.pos })).sort((a, b) => b.pos - a.pos);
            const leader = ordered[0];
            const second = ordered[1] || { pos: 0 };
            for (const ce of crossEvents) {
                if (ce.name === leader.name) {
                    const gap = leader.pos - (second.pos || 0);
                    if (gap > 0.5) tickEvents.push({ msg: `${ce.name} is moving into Stage ${ce.newStage} — ${gap.toFixed(1)}m ahead of second place!`, mag: gap, type: 'stageCross' });
                }
            }
        }

        stageEvents.push(...tickEvents);

        for (const r of racers) {
            if (r.finished && typeof r.finishedAt === 'number' && r.finishedAt < tick) {
                positionsHistory[r.name].push(null);
            } else {
                positionsHistory[r.name].push(Number((r.pos || 0).toFixed(3)));
            }
        }

        const isStageBoundary = (tick % ticksPerStage) === 0 || tick === stagesCap;
        if (isStageBoundary) {
            const positions = racers.map(r => ({ name: r.name, pos: r.pos })).sort((a, b) => b.pos - a.pos);
            const leader = positions[0] ? positions[0].name : null;
            const posWithSpeed = racers.map(r => ({ name: r.name, pos: r.pos, speed: r.speed }));
            const stageNumber = Math.ceil(tick / ticksPerStage);
            const mags = stageEvents.map(e => Math.abs(e.mag || 0)).sort((a, b) => a - b);
            const threshold = mags.length ? mags[Math.floor(Math.max(0, Math.floor(mags.length * 0.75) - 1))] : 0;
            const significant = stageEvents
                .filter(e => e.type === 'finish' || Math.abs(e.mag || 0) >= threshold)
                .map(e => ({ msg: e.msg, mag: Math.abs(e.mag || 0), type: e.type || 'event' }));
            stages.push({ stage: stageNumber, leader, positions: posWithSpeed, events: significant });
            stageEvents = [];
        }

        const unfinished = racers.filter(r => !r.finished).length;
        if (unfinished === 0) break;
    }

    const final = cumulative.map(c => {
        const racer = racers.find(r => r.name === c.name);
        return { name: c.name, total: c.total, finishedAt: racer.finishedAt || Infinity, finishedStage: racer.finishedAt ? Math.ceil(racer.finishedAt / ticksPerStage) : Infinity };
    }).sort((a, b) => a.finishedAt - b.finishedAt || b.total - a.total);

    return { stages, final, positionsHistory };
}

module.exports = { runRaceSimulation, STAT_MAX, clamp };
