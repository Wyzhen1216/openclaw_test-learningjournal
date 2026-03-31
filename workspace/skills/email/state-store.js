const path = require('path');

const {
    StoreFileError,
    generateId,
    isNonEmptyString,
    isValidEmail,
    nowIsoString,
    readJsonFile,
    writeJsonFile,
} = require('./utils');

const STATE_PATH = path.join(__dirname, 'pending-actions.json');
const DEFAULT_STATE_DATA = {
    version: 3,
    activeActionId: null,
    pendingActions: [],
    pendingGroupSelection: null,
};
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function deriveDraftSource(action) {
    const hasTemplate = isNonEmptyString(action.templateName) || Boolean(action.source && action.source.templateName);
    const isGroupDraft = Boolean(action.delivery && action.delivery.mode === 'group' && isNonEmptyString(action.delivery.groupName));

    if (hasTemplate && isGroupDraft) {
        return 'group_template_auto';
    }

    if (hasTemplate) {
        return 'template_auto';
    }

    if (isGroupDraft) {
        return 'group_send';
    }

    return 'manual';
}

function normalizePendingAction(action) {
    if (!action || typeof action !== 'object') {
        return action;
    }

    const delivery = action.delivery && typeof action.delivery === 'object'
        ? {
            mode: action.delivery.mode || (Array.isArray(action.recipients) && action.recipients.length > 1 ? 'list' : 'single'),
            groupName: isNonEmptyString(action.delivery.groupName) ? action.delivery.groupName : null,
        }
        : {
            mode: Array.isArray(action.recipients) && action.recipients.length > 1 ? 'list' : 'single',
            groupName: null,
        };

    const templateName = isNonEmptyString(action.templateName)
        ? action.templateName
        : (action.source && isNonEmptyString(action.source.templateName) ? action.source.templateName : null);
    const groupName = isNonEmptyString(action.groupName) ? action.groupName : delivery.groupName;

    const normalizedAction = {
        ...action,
        delivery: {
            ...delivery,
            groupName,
        },
        templateName,
        groupName,
        draftSource: action.draftSource || deriveDraftSource({
            ...action,
            delivery: {
                ...delivery,
                groupName,
            },
            templateName,
        }),
        requiresConfirmation: action.requiresConfirmation !== false,
        deliveryGuard: action.deliveryGuard || 'enabled',
        confirmationBypassed: action.confirmationBypassed === true,
    };

    if (!normalizedAction.source) {
        normalizedAction.source = templateName
            ? {
                kind: 'template',
                templateName,
            }
            : {
                kind: 'direct',
            };
    }

    return normalizedAction;
}

function loadData() {
    const data = readJsonFile(STATE_PATH, DEFAULT_STATE_DATA);
    let changed = false;

    if (!Object.prototype.hasOwnProperty.call(data, 'pendingGroupSelection')) {
        data.pendingGroupSelection = null;
        changed = true;
    }

    if (!data || !Array.isArray(data.pendingActions)) {
        throw new StoreFileError(
            'pending-actions.json 结构无效，请检查 pendingActions 字段是否为数组。',
            STATE_PATH,
            'STORE_FILE_INVALID'
        );
    }

    data.pendingActions = data.pendingActions.map((action) => {
        const normalizedAction = normalizePendingAction(action);
        if (JSON.stringify(normalizedAction) !== JSON.stringify(action)) {
            changed = true;
        }

        return normalizedAction;
    });

    if (data.version !== DEFAULT_STATE_DATA.version) {
        data.version = DEFAULT_STATE_DATA.version;
        changed = true;
    }

    if (changed) {
        saveData(data);
    }

    return data;
}

function saveData(data) {
    writeJsonFile(STATE_PATH, data);
}

function isExpired(action) {
    return Boolean(action.expiresAt) && Date.parse(action.expiresAt) <= Date.now();
}

function isValidPendingAction(action) {
    if (!action || !Array.isArray(action.recipients) || action.recipients.length === 0) {
        return false;
    }

    if (!isNonEmptyString(action.subject) || !isNonEmptyString(action.body)) {
        return false;
    }

    return action.recipients.every((recipient) => isValidEmail(recipient.email));
}

function isConfirmableAction(action) {
    return Boolean(
        action &&
        action.type === 'send_email' &&
        action.status === 'pending' &&
        action.requiresConfirmation === true &&
        action.deliveryGuard === 'enabled' &&
        action.confirmationBypassed !== true &&
        isValidPendingAction(action)
    );
}

function getActiveAction() {
    const data = loadData();

    if (!data.activeActionId) {
        return {
            action: null,
            warning: null,
        };
    }

    const action = data.pendingActions.find((item) => item.id === data.activeActionId);
    if (!action) {
        data.activeActionId = null;
        saveData(data);
        return {
            action: null,
            warning: '待确认任务状态异常，已自动清理，请重新发起发送。',
        };
    }

    if (action.status !== 'pending') {
        data.activeActionId = null;
        saveData(data);
        return {
            action: null,
            warning: '待确认任务不可用，已自动清理，请重新发起发送。',
        };
    }

    if (!isValidPendingAction(action)) {
        action.status = 'invalid';
        action.updatedAt = nowIsoString();
        data.activeActionId = null;
        saveData(data);
        return {
            action: null,
            warning: '待确认草稿内容异常，已自动清理，请重新发起发送。',
        };
    }

    if (isExpired(action)) {
        action.status = 'expired';
        action.updatedAt = nowIsoString();
        data.activeActionId = null;
        saveData(data);
        return {
            action: null,
            warning: '待确认草稿已过期，已自动清理，请重新发起发送。',
        };
    }

    return {
        action: normalizePendingAction(action),
        warning: null,
    };
}

function getActiveConfirmableAction() {
    const { action, warning } = getActiveAction();
    if (!action) {
        return {
            action: null,
            warning,
        };
    }

    if (isConfirmableAction(action)) {
        return {
            action,
            warning,
        };
    }

    const data = loadData();
    const storedAction = data.pendingActions.find((item) => item.id === data.activeActionId);
    if (storedAction) {
        storedAction.status = 'invalid';
        storedAction.updatedAt = nowIsoString();
    }
    data.activeActionId = null;
    saveData(data);

    return {
        action: null,
        warning: joinInvalidGuardWarning(warning),
    };
}

function joinInvalidGuardWarning(warning) {
    const guardWarning = '待确认草稿未通过发送校验，已自动清理，请重新起草后再确认发送。';
    return warning ? `${warning}\n\n${guardWarning}` : guardWarning;
}

function createPendingAction(payload) {
    if (!isValidPendingAction(payload)) {
        throw new Error('待确认草稿缺少必要字段，无法保存。');
    }

    const data = loadData();
    let replacedActionId = null;

    if (data.activeActionId) {
        const currentAction = data.pendingActions.find((item) => item.id === data.activeActionId);
        if (currentAction && currentAction.status === 'pending') {
            currentAction.status = 'replaced';
            currentAction.updatedAt = nowIsoString();
            replacedActionId = currentAction.id;
        }
    }

    const now = nowIsoString();
    const action = normalizePendingAction({
        id: generateId('pending'),
        type: 'send_email',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
        ...payload,
    });

    data.pendingActions.push(action);
    data.activeActionId = action.id;
    if (data.pendingGroupSelection && data.pendingGroupSelection.status === 'pending') {
        data.pendingGroupSelection.status = 'resolved';
        data.pendingGroupSelection.updatedAt = nowIsoString();
    }
    data.pendingGroupSelection = null;
    saveData(data);

    return {
        action,
        replacedActionId,
    };
}

function updateActiveAction(patch) {
    const data = loadData();
    const actionIndex = data.pendingActions.findIndex((item) => item.id === data.activeActionId);
    const action = actionIndex === -1 ? null : data.pendingActions[actionIndex];

    if (!action || action.status !== 'pending') {
        return null;
    }

    const nextAction = normalizePendingAction({
        ...action,
        ...patch,
        updatedAt: nowIsoString(),
    });
    data.pendingActions[actionIndex] = nextAction;

    if (!isValidPendingAction(nextAction)) {
        throw new Error('草稿更新后缺少必要字段，已拒绝此次修改。');
    }

    saveData(data);
    return nextAction;
}

function cancelActiveAction(reason = 'cancelled') {
    const data = loadData();
    const action = data.pendingActions.find((item) => item.id === data.activeActionId);

    if (!action || action.status !== 'pending') {
        return null;
    }

    action.status = 'cancelled';
    action.cancelReason = reason;
    action.updatedAt = nowIsoString();
    data.activeActionId = null;
    data.pendingGroupSelection = null;
    saveData(data);
    return action;
}

function completeActiveAction(metadata = {}) {
    const data = loadData();
    const action = data.pendingActions.find((item) => item.id === data.activeActionId);

    if (!action || action.status !== 'pending') {
        return null;
    }

    Object.assign(action, metadata, {
        status: 'sent',
        sentAt: metadata.sentAt || nowIsoString(),
        updatedAt: nowIsoString(),
    });
    data.activeActionId = null;
    data.pendingGroupSelection = null;
    saveData(data);
    return action;
}

function getPendingGroupSelection() {
    const data = loadData();
    const selection = data.pendingGroupSelection;

    if (!selection) {
        return {
            selection: null,
            warning: null,
        };
    }

    if (selection.status !== 'pending') {
        data.pendingGroupSelection = null;
        saveData(data);
        return {
            selection: null,
            warning: '群组候选确认状态异常，已自动清理，请重新发起。',
        };
    }

    if (isExpired(selection)) {
        selection.status = 'expired';
        selection.updatedAt = nowIsoString();
        data.pendingGroupSelection = null;
        saveData(data);
        return {
            selection: null,
            warning: '群组候选确认已过期，请重新发起。',
        };
    }

    return {
        selection,
        warning: null,
    };
}

function setPendingGroupSelection(payload) {
    const data = loadData();
    const now = nowIsoString();

    data.pendingGroupSelection = {
        id: generateId('group_selection'),
        type: 'group_selection',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
        ...payload,
    };

    saveData(data);
    return data.pendingGroupSelection;
}

function clearPendingGroupSelection(reason = 'resolved') {
    const data = loadData();
    const selection = data.pendingGroupSelection;

    if (!selection || selection.status !== 'pending') {
        data.pendingGroupSelection = null;
        saveData(data);
        return null;
    }

    selection.status = reason;
    selection.updatedAt = nowIsoString();
    data.pendingGroupSelection = null;
    saveData(data);
    return selection;
}

module.exports = {
    STATE_PATH,
    cancelActiveAction,
    clearPendingGroupSelection,
    completeActiveAction,
    createPendingAction,
    getActiveAction,
    getActiveConfirmableAction,
    getPendingGroupSelection,
    setPendingGroupSelection,
    updateActiveAction,
};
