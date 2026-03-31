#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'runtime', 'session-maintenance.json');
const DEFAULT_STATE = {
    version: 1,
    lastConversationResetAt: null,
    lastUserActiveAt: null,
    pendingResetDate: null,
    lastCheckAt: null,
    lastCheckSource: null,
};
const RESET_IDLE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
const WORKSPACE_TIME_ZONE = 'Asia/Shanghai';

function ensureStateFile() {
    const directory = path.dirname(STATE_PATH);
    fs.mkdirSync(directory, { recursive: true });

    if (!fs.existsSync(STATE_PATH)) {
        fs.writeFileSync(STATE_PATH, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`, 'utf8');
    }
}

function getTodayKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: WORKSPACE_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function parseIsoTime(value) {
    if (!value) {
        return null;
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
}

function loadState() {
    ensureStateFile();

    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
        ...DEFAULT_STATE,
        ...data,
    };
}

function saveState(state) {
    ensureStateFile();
    fs.writeFileSync(
        STATE_PATH,
        `${JSON.stringify(
            {
                ...DEFAULT_STATE,
                ...state,
            },
            null,
            2
        )}\n`,
        'utf8'
    );
}

function buildResult({ source, now, state }) {
    const nowIso = now.toISOString();
    const today = getTodayKey(now);
    const lastResetAt = parseIsoTime(state.lastConversationResetAt);
    const lastResetDate = lastResetAt ? getTodayKey(new Date(lastResetAt)) : null;
    const lastUserActiveAt = parseIsoTime(state.lastUserActiveAt);
    const idleMs = lastUserActiveAt ? now.getTime() - lastUserActiveAt : null;
    const idleHours = idleMs === null ? null : Number((idleMs / (60 * 60 * 1000)).toFixed(2));
    const alreadyResetToday = lastResetDate === today;
    const shouldRefreshToday = !alreadyResetToday;
    const userRecentlyActive = idleMs !== null && idleMs < RESET_IDLE_THRESHOLD_MS;

    state.lastCheckAt = nowIso;
    state.lastCheckSource = source;

    if (source === 'user-message') {
        if (shouldRefreshToday) {
            if (idleMs === null || idleMs >= RESET_IDLE_THRESHOLD_MS) {
                state.lastConversationResetAt = nowIso;
                state.pendingResetDate = null;
            } else {
                state.pendingResetDate = today;
            }
        }

        state.lastUserActiveAt = nowIso;
    } else if (source === 'heartbeat') {
        if (shouldRefreshToday) {
            state.pendingResetDate = state.pendingResetDate || today;

            if (!userRecentlyActive) {
                state.lastConversationResetAt = nowIso;
                state.pendingResetDate = null;
            }
        }
    } else if (source === 'mark-reset') {
        state.lastConversationResetAt = nowIso;
        state.pendingResetDate = null;
    }

    saveState(state);

    const refreshedToday = getTodayKey(new Date(parseIsoTime(state.lastConversationResetAt) || 0)) === today;
    const shouldRefreshNow = refreshedToday && state.lastConversationResetAt === nowIso;

    return {
        source,
        now: nowIso,
        today,
        shouldRefreshToday: !refreshedToday,
        shouldRefreshNow,
        alreadyResetToday: refreshedToday && !shouldRefreshNow,
        userRecentlyActive,
        idleHours,
        pendingResetDate: state.pendingResetDate,
        state,
    };
}

function main() {
    const source = process.argv[2] || 'status';
    const allowedSources = new Set(['status', 'user-message', 'heartbeat', 'mark-reset']);

    if (!allowedSources.has(source)) {
        console.error('Usage: node .openclaw/workspace/session-maintenance.js [status|user-message|heartbeat|mark-reset]');
        process.exit(1);
    }

    const state = loadState();
    const now = new Date();

    if (source === 'status') {
        const lastResetAt = parseIsoTime(state.lastConversationResetAt);
        const lastUserActiveAt = parseIsoTime(state.lastUserActiveAt);
        const today = getTodayKey(now);
        const alreadyResetToday = lastResetAt ? getTodayKey(new Date(lastResetAt)) === today : false;
        const idleMs = lastUserActiveAt ? now.getTime() - lastUserActiveAt : null;

        console.log(
            JSON.stringify(
                {
                    source,
                    now: now.toISOString(),
                    today,
                    alreadyResetToday,
                    pendingResetDate: state.pendingResetDate,
                    idleHours: idleMs === null ? null : Number((idleMs / (60 * 60 * 1000)).toFixed(2)),
                    state,
                },
                null,
                2
            )
        );
        return;
    }

    console.log(JSON.stringify(buildResult({ source, now, state }), null, 2));
}

if (require.main === module) {
    main();
}
