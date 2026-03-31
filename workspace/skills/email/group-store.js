const path = require('path');

const {
    StoreFileError,
    formatRecipient,
    generateId,
    isNonEmptyString,
    isValidEmail,
    normalizeName,
    nowIsoString,
    readJsonFile,
    writeJsonFile,
} = require('./utils');

const GROUP_PATH = path.join(__dirname, 'groups.json');
const DEFAULT_GROUP_DATA = {
    version: 1,
    groups: [],
};
const GROUP_SUFFIX_PATTERNS = [/(?:邮件群组|邮件组|群组|小组|组)$/u];

function loadData() {
    const data = readJsonFile(GROUP_PATH, DEFAULT_GROUP_DATA);

    if (!data || !Array.isArray(data.groups)) {
        throw new StoreFileError(
            'groups.json 结构无效，请检查 groups 字段是否为数组。',
            GROUP_PATH,
            'STORE_FILE_INVALID'
        );
    }

    return data;
}

function saveData(data) {
    writeJsonFile(GROUP_PATH, data);
}

function normalizeMember(member) {
    const normalizedEmail = String(member.email || '').trim();
    if (!isValidEmail(normalizedEmail)) {
        throw new Error(`邮箱地址无效：${member.email || ''}`);
    }

    return {
        name: String(member.name || '').trim(),
        email: normalizedEmail,
    };
}

function listGroups() {
    const data = loadData();
    return [...data.groups].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

function normalizeGroupName(value) {
    let normalized = normalizeName(value);
    if (!isNonEmptyString(normalized)) {
        return '';
    }

    normalized = normalized.normalize('NFKC').toLowerCase().replace(/[\s"'“”‘’]/gu, '');

    let changed = true;
    while (changed && normalized) {
        changed = false;
        for (const pattern of GROUP_SUFFIX_PATTERNS) {
            const next = normalized.replace(pattern, '');
            if (next !== normalized) {
                normalized = next;
                changed = true;
            }
        }
    }

    return normalized;
}

function getCharacterOverlapScore(left, right) {
    const leftSet = new Set(Array.from(left));
    const rightSet = new Set(Array.from(right));
    const union = new Set([...leftSet, ...rightSet]);

    if (union.size === 0) {
        return 0;
    }

    let overlap = 0;
    for (const char of leftSet) {
        if (rightSet.has(char)) {
            overlap += 1;
        }
    }

    return overlap / union.size;
}

function scoreGroupCandidate(inputName, groupName) {
    const normalizedInput = normalizeGroupName(inputName);
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!normalizedInput || !normalizedGroupName) {
        return 0;
    }

    if (normalizedInput === normalizedGroupName) {
        return 1;
    }

    let score = 0;

    if (normalizedGroupName.includes(normalizedInput) || normalizedInput.includes(normalizedGroupName)) {
        score = Math.max(score, 0.92);
    }

    const overlapScore = getCharacterOverlapScore(normalizedInput, normalizedGroupName);
    if (overlapScore >= 0.34) {
        score = Math.max(score, 0.45 + overlapScore * 0.45);
    }

    return score;
}

function findGroupMatch(name, { maxCandidates = 3, minCandidateScore = 0.6 } = {}) {
    const targetName = normalizeName(name);
    if (!isNonEmptyString(targetName)) {
        return {
            requestedName: '',
            group: null,
            matchType: 'none',
            candidates: [],
        };
    }

    const data = loadData();
    const exactGroup = data.groups.find((group) => group.name === targetName) || null;
    if (exactGroup) {
        return {
            requestedName: targetName,
            group: exactGroup,
            matchType: 'exact',
            candidates: [],
        };
    }

    const normalizedTargetName = normalizeGroupName(targetName);
    const normalizedGroups = data.groups.filter((group) => normalizeGroupName(group.name) === normalizedTargetName);
    if (normalizedGroups.length > 0) {
        const sortedMatches = [...normalizedGroups].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
        return {
            requestedName: targetName,
            group: sortedMatches[0],
            matchType: 'normalized',
            candidates: [],
        };
    }

    const candidates = data.groups
        .map((group) => ({
            ...group,
            matchScore: scoreGroupCandidate(targetName, group.name),
        }))
        .filter((group) => group.matchScore >= minCandidateScore)
        .sort((left, right) => {
            if (right.matchScore !== left.matchScore) {
                return right.matchScore - left.matchScore;
            }

            return left.name.localeCompare(right.name, 'zh-Hans-CN');
        })
        .slice(0, maxCandidates);

    return {
        requestedName: targetName,
        group: null,
        matchType: candidates.length > 0 ? 'candidate' : 'none',
        candidates,
    };
}

function getGroupByName(name) {
    const targetName = normalizeName(name);
    if (!isNonEmptyString(targetName)) {
        return null;
    }

    const data = loadData();
    return data.groups.find((group) => group.name === targetName) || null;
}

function createGroup({ name, members = [] }) {
    const groupName = normalizeName(name);
    if (!isNonEmptyString(groupName)) {
        throw new Error('群组名称不能为空。');
    }

    const normalizedMembers = [];
    const seenEmails = new Set();
    for (const member of members) {
        const normalizedMember = normalizeMember(member);
        if (seenEmails.has(normalizedMember.email)) {
            continue;
        }

        seenEmails.add(normalizedMember.email);
        normalizedMembers.push(normalizedMember);
    }

    const data = loadData();
    if (data.groups.some((group) => group.name === groupName)) {
        throw new Error(`群组“${groupName}”已存在。`);
    }

    const now = nowIsoString();
    const group = {
        id: generateId('group'),
        name: groupName,
        members: normalizedMembers,
        createdAt: now,
        updatedAt: now,
    };

    data.groups.push(group);
    saveData(data);
    return group;
}

function addMember(groupName, member) {
    const targetGroupName = normalizeName(groupName);
    const normalizedMember = normalizeMember(member);
    const data = loadData();
    const group = data.groups.find((item) => item.name === targetGroupName);

    if (!group) {
        throw new Error(`群组“${targetGroupName}”不存在。`);
    }

    if (group.members.some((existing) => existing.email === normalizedMember.email)) {
        throw new Error(`成员 ${formatRecipient(normalizedMember)} 已在群组“${targetGroupName}”中。`);
    }

    group.members.push(normalizedMember);
    group.updatedAt = nowIsoString();
    saveData(data);
    return group;
}

function removeMember(groupName, identifier) {
    const targetGroupName = normalizeName(groupName);
    const normalizedIdentifier = normalizeName(identifier);
    const data = loadData();
    const group = data.groups.find((item) => item.name === targetGroupName);

    if (!group) {
        throw new Error(`群组“${targetGroupName}”不存在。`);
    }

    let matches;
    if (isValidEmail(normalizedIdentifier)) {
        matches = group.members.filter((member) => member.email === normalizedIdentifier);
    } else {
        matches = group.members.filter((member) => member.name === normalizedIdentifier);
    }

    if (matches.length === 0) {
        throw new Error(`群组“${targetGroupName}”中没有找到成员“${normalizedIdentifier}”。`);
    }

    if (matches.length > 1) {
        throw new Error(`群组“${targetGroupName}”中有多个成员同名“${normalizedIdentifier}”，请改用邮箱删除。`);
    }

    group.members = group.members.filter((member) => member !== matches[0]);
    group.updatedAt = nowIsoString();
    saveData(data);
    return {
        group,
        removedMember: matches[0],
    };
}

function deleteGroup(name) {
    const targetGroupName = normalizeName(name);
    const data = loadData();
    const index = data.groups.findIndex((group) => group.name === targetGroupName);

    if (index === -1) {
        return null;
    }

    const [deletedGroup] = data.groups.splice(index, 1);
    saveData(data);
    return deletedGroup;
}

module.exports = {
    GROUP_PATH,
    addMember,
    createGroup,
    deleteGroup,
    findGroupMatch,
    getGroupByName,
    listGroups,
    normalizeGroupName,
    removeMember,
};
