#!/usr/bin/env node

const groupStore = require('./group-store');
const { loadConfig: loadReadConfig, readEmailByUid, readEmails, readEmailsSince } = require('./read-email');
const { sendEmail } = require('./send-email');
const stateStore = require('./state-store');
const templateStore = require('./template-store');
const {
    StoreFileError,
    addPrefixMessage,
    collectTemplateVariables,
    formatNumberedRecipients,
    formatRecipient,
    isNonEmptyString,
    normalizeName,
    parseRecipientList,
    stripWrappingQuotes,
} = require('./utils');

const SEND_VERB_REGEX = /(?:发邮件|发送邮件|写邮件|寄邮件)/u;
const READ_INTENT_REGEX = /(?:查看|读取|读|列出).*(?:邮件|收件箱)|(?:最近)\s*\d+\s*封邮件|UID\s*\d+/iu;

function findEarliestMatch(text, regexes = []) {
    let bestMatch = null;

    for (const regex of regexes) {
        const match = new RegExp(regex.source, regex.flags.replace(/g/g, '')).exec(text);
        if (!match) {
            continue;
        }

        if (!bestMatch || match.index < bestMatch.index) {
            bestMatch = match;
        }
    }

    return bestMatch;
}

function trimTrailingPunctuation(value) {
    return String(value || '')
        .trim()
        .replace(/[，,；;]+$/u, '')
        .trim();
}

function extractValueAfterLabels(text, labelRegexes, endRegexes = []) {
    const match = findEarliestMatch(text, labelRegexes);
    if (!match) {
        return null;
    }

    let remainder = text.slice(match.index + match[0].length).trim();
    remainder = remainder.replace(/^[：:，,\s]+/u, '').trim();

    if (!remainder) {
        return null;
    }

    const quotePairs = {
        '"': '"',
        '\'': '\'',
        '“': '”',
        '‘': '’',
    };
    const openingQuote = remainder[0];

    if (quotePairs[openingQuote]) {
        const closingQuote = quotePairs[openingQuote];
        const closingIndex = remainder.indexOf(closingQuote, 1);
        if (closingIndex !== -1) {
            return trimTrailingPunctuation(remainder.slice(1, closingIndex));
        }
    }

    const endMatch = findEarliestMatch(remainder, endRegexes);
    if (!endMatch) {
        return trimTrailingPunctuation(remainder);
    }

    return trimTrailingPunctuation(remainder.slice(0, endMatch.index));
}

function extractFirstQuotedValue(text) {
    const match = text.match(/[“"]([^”"]+)[”"]/u);
    if (match) {
        return match[1].trim();
    }

    return null;
}

function parseVariableAssignments(text) {
    const assignments = {};
    const pattern = /(?:^|[，,；;\s])([A-Za-z_][A-Za-z0-9_-]*)\s*(?:=|是|为)\s*(?:"([^"]+)"|“([^”]+)”|([^，,；;\n]+))/gu;

    let match;
    while ((match = pattern.exec(text)) !== null) {
        const key = match[1];
        const value = trimTrailingPunctuation(match[2] || match[3] || match[4] || '');
        if (key && value) {
            assignments[key] = value;
        }
    }

    return assignments;
}

function isReadIntent(text) {
    return READ_INTENT_REGEX.test(text);
}

function isConfirmCommand(text) {
    return /^(确认发送|确认)$/u.test(text.trim());
}

function isCancelCommand(text) {
    return /^(取消发送|取消)$/u.test(text.trim());
}

function isShowDraftCommand(text) {
    return /^(查看草稿|查看待发送草稿|预览草稿)$/u.test(text.trim());
}

function parseConfirmGroupCommand(text) {
    const match = text.trim().match(/^确认群组\s+(.+)$/u);
    if (!match) {
        return null;
    }

    return normalizeName(match[1]);
}

function joinWarnings(...warnings) {
    const parts = warnings.filter((warning) => isNonEmptyString(warning));
    return parts.length > 0 ? parts.join('\n\n') : null;
}

function parseDraftModification(text, groups) {
    const subject = extractValueAfterLabels(text, [/修改主题(?:为|成)?/u, /主题改(?:为|成)/u, /^主题/u]);
    if (subject !== null) {
        return { subject };
    }

    const body = extractValueAfterLabels(text, [/修改(?:正文|内容)(?:为|成)?/u, /(?:正文|内容)改(?:为|成)/u, /^(?:正文|内容)/u]);
    if (body !== null) {
        return { body };
    }

    const recipientText = extractValueAfterLabels(text, [/修改收件人(?:为|成)?/u, /收件人改(?:为|成)/u, /^收件人/u]);
    if (recipientText !== null) {
        const resolved = resolveRecipientTarget(recipientText, groups);
        if (resolved.requiresGroupConfirmation) {
            return {
                pendingGroupTarget: resolved,
            };
        }

        return {
            recipients: resolved.recipients,
            delivery: resolved.delivery,
        };
    }

    return null;
}

function ensureSendContent({ recipients, subject, body }) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error('收件人不能为空。');
    }

    if (!isNonEmptyString(subject)) {
        throw new Error('主题不能为空。');
    }

    if (!isNonEmptyString(body)) {
        throw new Error('正文不能为空。');
    }
}

function resolveRecipientTarget(rawTarget, groups) {
    const target = stripWrappingQuotes(String(rawTarget || '').trim());
    if (!target) {
        throw new Error('未识别到收件人，请提供邮箱地址或已有群组名。');
    }

    const groupMatch = groups.findGroupMatch(target);
    if (groupMatch.group) {
        if (!Array.isArray(groupMatch.group.members) || groupMatch.group.members.length === 0) {
            throw new Error(`群组“${groupMatch.group.name}”为空，不能发信。`);
        }

        return {
            recipients: groupMatch.group.members.map((member) => ({
                name: member.name,
                email: member.email,
            })),
            delivery: {
                mode: 'group',
                groupName: groupMatch.group.name,
            },
        };
    }

    const parsed = parseRecipientList(target);
    if (parsed.invalidTokens.length > 0) {
        if (parsed.recipients.length === 0 && parsed.invalidTokens.length === 1 && groupMatch.candidates.length > 0) {
            return {
                requiresGroupConfirmation: true,
                requestedGroupName: groupMatch.requestedName,
                candidates: groupMatch.candidates.map((group) => ({
                    name: group.name,
                    memberCount: group.members.length,
                })),
            };
        }

        throw new Error(`以下收件人格式无法识别：${parsed.invalidTokens.join('、')}。请使用 email 或 姓名<email> 格式。`);
    }

    if (parsed.recipients.length === 0) {
        throw new Error('收件人不能为空。');
    }

    return {
        recipients: parsed.recipients,
        delivery: {
            mode: parsed.recipients.length > 1 ? 'list' : 'single',
            groupName: null,
        },
    };
}

function buildGroupCandidatesPrompt({ requestedGroupName, candidates, intentLabel = '使用', allowConfirmation = true }) {
    const lines = [`未找到名为“${requestedGroupName}”的群组。`];

    if (candidates.length === 1) {
        lines.push(`你是不是想${intentLabel}“${candidates[0].name}”？`);
    } else {
        lines.push('你可能想使用以下群组：');
        candidates.forEach((candidate, index) => {
            lines.push(`${index + 1}. ${candidate.name}${typeof candidate.memberCount === 'number' ? `（${candidate.memberCount} 人）` : ''}`);
        });
    }

    const preferredName = candidates[0] ? candidates[0].name : '';
    if (preferredName && allowConfirmation) {
        lines.push(`回复“确认群组 ${preferredName}”继续，或回复“查看所有群组”。`);
    } else if (preferredName) {
        lines.push(`请改用准确群组名“${preferredName}”重试，或回复“查看所有群组”。`);
    } else {
        lines.push('回复“查看所有群组”查看现有群组。');
    }

    return lines.join('\n');
}

function buildPendingGroupSelectionPayload(target, intent) {
    return {
        requestedGroupName: target.requestedGroupName,
        candidates: target.candidates,
        intent,
    };
}

function resolveGroupCommandMatch(groupName) {
    const match = groupStore.findGroupMatch(groupName);

    if (match.group) {
        return {
            group: match.group,
            message: null,
        };
    }

    if (match.candidates.length > 0) {
        return {
            group: null,
            message: buildGroupCandidatesPrompt({
                requestedGroupName: match.requestedName,
                candidates: match.candidates.map((group) => ({
                    name: group.name,
                    memberCount: group.members.length,
                })),
                intentLabel: '使用群组',
                allowConfirmation: false,
            }),
        };
    }

    return {
        group: null,
        message: `群组“${normalizeName(groupName)}”不存在。回复“查看所有群组”可查看现有群组。`,
    };
}

function buildDraftPreview(action, title = '【草稿预览】') {
    const lines = [title];

    const draftMethodMap = {
        manual: '普通邮件',
        template_auto: '模板',
        group_send: '群组邮件',
        group_template_auto: '群组+模板',
    };

    lines.push(`起草方式：${draftMethodMap[action.draftSource] || '普通邮件'}`);
    if (action.templateName) {
        lines.push(`模板：${action.templateName}`);
    }

    if (action.groupName) {
        lines.push(`群组：${action.groupName}`);
    }

    if (action.recipients.length === 1) {
        lines.push(`收件人：${formatRecipient(action.recipients[0])}`);
    } else {
        lines.push('收件人：');
        lines.push(formatNumberedRecipients(action.recipients));
    }

    lines.push(`主题：${action.subject}`);
    lines.push('正文：');
    lines.push(action.body);

    if (action.lastError) {
        lines.push(`上次发送失败：${action.lastError}`);
    }

    lines.push('请回复“确认发送”继续，或回复“修改……”调整，或回复“取消发送”终止。');
    return lines.join('\n');
}

function formatTemplateList(templates) {
    if (templates.length === 0) {
        return '【模板列表】\n当前还没有已保存模板。';
    }

    const lines = ['【模板列表】'];
    templates.forEach((template, index) => {
        lines.push(`${index + 1}. ${template.name}`);
        lines.push(`主题模板：${template.subjectTemplate}`);
    });

    return lines.join('\n');
}

function formatTemplateDetail(template) {
    const lines = [
        '【模板详情】',
        `名称：${template.name}`,
        `主题模板：${template.subjectTemplate}`,
        '正文模板：',
        template.bodyTemplate,
        `变量：${template.variables && template.variables.length > 0 ? template.variables.join('、') : '无'}`,
    ];

    return lines.join('\n');
}

function formatGroupList(groups) {
    if (groups.length === 0) {
        return '【群组列表】\n当前还没有已保存群组。';
    }

    const lines = ['【群组列表】'];
    groups.forEach((group, index) => {
        lines.push(`${index + 1}. ${group.name}（${group.members.length} 人）`);
    });

    return lines.join('\n');
}

function formatGroupDetail(group) {
    const lines = [
        '【群组查看】',
        `群组：${group.name}`,
        '成员：',
    ];

    if (!group.members || group.members.length === 0) {
        lines.push('无');
        return lines.join('\n');
    }

    lines.push(formatNumberedRecipients(group.members));
    return lines.join('\n');
}

function formatEmailList(emails, limit) {
    if (emails.length === 0) {
        return '【邮件列表】\n未找到符合条件的邮件。';
    }

    const lines = [`【最近 ${limit} 封邮件】`];
    emails.forEach((email, index) => {
        lines.push(`${index + 1}. UID ${email.uid} | ${email.subject}`);
        lines.push(`发件人：${email.from}`);
        lines.push(`时间：${email.date}`);
        lines.push(`预览：${email.preview}`);
    });

    return lines.join('\n');
}

function formatSingleEmail(email) {
    return [
        '【邮件详情】',
        `UID：${email.uid}`,
        `主题：${email.subject}`,
        `发件人：${email.from}`,
        `收件人：${email.to || '(未提供)'}`,
        `时间：${email.date}`,
        '正文：',
        email.content || '(无内容)',
    ].join('\n');
}

async function handleReadRequest(text) {
    const config = loadReadConfig();
    const uidMatch = text.match(/UID\s*(\d+)/iu);
    if (uidMatch) {
        const email = await readEmailByUid(config, Number(uidMatch[1]));
        return formatSingleEmail(email);
    }

    const sinceMatch = text.match(/(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?).*(?:之后|以后|以来).*(?:邮件|收件箱)/u);
    if (sinceMatch) {
        const emails = await readEmailsSince(config, sinceMatch[1]);
        if (emails.length === 0) {
            return '【邮件列表】\n指定时间之后没有新邮件。';
        }

        const lines = [`【${sinceMatch[1]} 之后的邮件】`];
        emails.forEach((email, index) => {
            lines.push(`${index + 1}. UID ${email.uid} | ${email.subject}`);
            lines.push(`发件人：${email.from}`);
            lines.push(`时间：${email.date}`);
            lines.push('正文：');
            lines.push(email.content || '(无内容)');
        });
        return lines.join('\n');
    }

    const limitMatch = text.match(/(?:最近|查看|读取|列出)\s*(\d+)\s*封邮件/u);
    const limit = limitMatch ? Number(limitMatch[1]) : 10;
    const emails = await readEmails(config, limit);
    return formatEmailList(emails, limit);
}

function parseTemplateCreateRequest(text) {
    if (!/(?:保存|创建|新增).*(?:模板)/u.test(text)) {
        return null;
    }

    const subjectLabels = [/主题(?:是|为)?/u];
    const bodyLabels = [/(?:正文|内容)(?:是|为)?/u];
    const name = extractValueAfterLabels(text, [/(?:名字叫|名为|模板叫|叫)/u], [...subjectLabels, ...bodyLabels]);
    const subjectTemplate = extractValueAfterLabels(text, subjectLabels, bodyLabels);
    const bodyTemplate = extractValueAfterLabels(text, bodyLabels);

    if (!name || !subjectTemplate || !bodyTemplate) {
        return null;
    }

    return {
        name,
        subjectTemplate,
        bodyTemplate,
    };
}

function parseTemplateNameCommand(text, actionWord) {
    const quoted = extractFirstQuotedValue(text);
    if (quoted) {
        return quoted;
    }

    const regex = new RegExp(`${actionWord}\\s*模板\\s*([^，,\\s]+)`, 'u');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
}

function parseGroupCreateRequest(text) {
    if (!/(?:创建|新增).*(?:群组)/u.test(text)) {
        return null;
    }

    const memberLabels = [/(?:成员有|成员是|成员为)/u];
    const name = extractValueAfterLabels(text, [/(?:群组叫|群组名为|群组名字叫|名字叫|名为|叫)/u], memberLabels);
    const membersText = extractValueAfterLabels(text, memberLabels);

    if (!name || membersText === null) {
        return null;
    }

    return {
        name,
        membersText,
    };
}

function parseGroupMemberAddRequest(text) {
    if (!/(?:加|添加).*(?:成员)/u.test(text)) {
        return null;
    }

    const groupName = extractFirstQuotedValue(text);
    const memberText = extractValueAfterLabels(text, [/(?:成员)/u]);

    if (!groupName || !memberText) {
        return null;
    }

    return {
        groupName,
        memberText,
    };
}

function parseGroupMemberRemoveRequest(text) {
    const match = text.match(/(?:把)?[“"]([^”"]+)[”"].*?(?:里的|中?的)\s*([^，,\s]+)\s*(?:删掉|删除|移除)/u);
    if (!match) {
        return null;
    }

    return {
        groupName: match[1].trim(),
        memberIdentifier: stripWrappingQuotes(match[2].trim()),
    };
}

function parseTemplateSendRequest(text) {
    if (!/(?:用|使用).*(?:模板).*(?:发邮件|发送邮件|写邮件|寄邮件)/u.test(text)) {
        return null;
    }

    let templateName = null;
    const quotedMatch = text.match(/(?:用|使用)\s*[“"]([^”"]+)[”"]\s*模板/u);
    if (quotedMatch) {
        templateName = quotedMatch[1].trim();
    } else {
        const bareMatch = text.match(/(?:用|使用)\s*([^，,\s]+)\s*模板/u);
        templateName = bareMatch ? bareMatch[1].trim() : null;
    }

    const targetMatch = text.match(/模板\s*(?:给|发给)\s*([\s\S]+?)\s*(?:发邮件|发送邮件|写邮件|寄邮件)/u);
    if (!templateName || !targetMatch) {
        return null;
    }

    return {
        templateName,
        targetText: targetMatch[1].trim(),
        variables: parseVariableAssignments(text),
    };
}

function parseDirectSendRequest(text) {
    if (!SEND_VERB_REGEX.test(text)) {
        return null;
    }

    const targetMatch = text.match(/(?:给|发给)\s*([\s\S]+?)\s*(?:发邮件|发送邮件|写邮件|寄邮件)/u);
    if (!targetMatch) {
        return null;
    }

    const explicitSubject = extractValueAfterLabels(text, [/主题(?:是|为)?/u], [/(?:正文|内容)(?:是|为)?/u]);
    const explicitBody = extractValueAfterLabels(text, [/(?:正文|内容)(?:是|为)?/u]);
    const trailingInstruction = trimTrailingPunctuation(text.slice(text.indexOf(targetMatch[0]) + targetMatch[0].length));

    let subject = explicitSubject;
    let body = explicitBody;

    if (subject === null || body === null) {
        const inferred = inferDraftContentFromInstruction(trailingInstruction);
        if (!inferred) {
            return null;
        }

        subject = subject === null ? inferred.subject : subject;
        body = body === null ? inferred.body : body;
    }

    return {
        targetText: targetMatch[1].trim(),
        subject,
        body,
        requestText: text,
    };
}

function buildPendingPayload({ recipients, delivery, subject, body, source }) {
    ensureSendContent({ recipients, subject, body });

    const isGroupDraft = Boolean(delivery && delivery.mode === 'group' && isNonEmptyString(delivery.groupName));
    const templateName = source && isNonEmptyString(source.templateName) ? source.templateName : null;
    const draftSource = templateName
        ? (isGroupDraft ? 'group_template_auto' : 'template_auto')
        : (isGroupDraft ? 'group_send' : 'manual');

    return {
        recipients,
        delivery,
        subject: subject.trim(),
        body: body.trim(),
        source,
        draftSource,
        templateName,
        groupName: isGroupDraft ? delivery.groupName : null,
        requiresConfirmation: true,
        deliveryGuard: 'enabled',
        confirmationBypassed: false,
    };
}

function inferDraftContentFromInstruction(instruction) {
    const content = trimTrailingPunctuation(String(instruction || '').replace(/^[：:，,\s]+/u, ''));
    if (!content) {
        return null;
    }

    const compactSubject = content.replace(/\s+/gu, ' ').trim();
    const subject = compactSubject.length > 24 ? `${compactSubject.slice(0, 24)}...` : compactSubject;

    return {
        subject: subject || '邮件通知',
        body: content,
    };
}

function buildPendingPreviewResponse(pendingResult, warningMessage) {
    const replacementMessage = pendingResult.replacedActionId ? '已用新的草稿替换之前的待确认任务。' : null;
    return addPrefixMessage(buildDraftPreview(pendingResult.action), joinWarnings(warningMessage, replacementMessage));
}

function buildAutoTemplateDraft(requestText, variables = {}) {
    const templateMatch = templateStore.findBestTemplateMatch(requestText);
    if (!templateMatch) {
        return null;
    }

    const rendered = templateStore.renderTemplate(templateMatch.template.name, variables);
    if (!rendered || rendered.missingVariables.length > 0) {
        return null;
    }

    return {
        subject: rendered.subject,
        body: rendered.body,
        source: {
            kind: 'template_auto',
            templateName: rendered.template.name,
            variables,
            matchedTerms: templateMatch.matchedTerms,
            matchScore: Number(templateMatch.score.toFixed(3)),
        },
    };
}

async function handlePendingCommand(text, activeAction, warningMessage) {
    if (isConfirmCommand(text)) {
        const { action: confirmableAction, warning: confirmWarning } = stateStore.getActiveConfirmableAction();
        const combinedConfirmWarning = joinWarnings(warningMessage, confirmWarning);
        if (!confirmableAction) {
            return addPrefixMessage('当前没有待确认的邮件草稿。请先发起一封邮件。', combinedConfirmWarning);
        }

        try {
            const result = await sendEmail({
                to: confirmableAction.recipients.map((recipient) => recipient.email).join(','),
                subject: confirmableAction.subject,
                body: confirmableAction.body,
            });

            stateStore.completeActiveAction({
                sendResult: {
                    method: result.method,
                    messageId: result.messageId || null,
                },
            });

            const lines = [
                '【发送成功】',
                `已发送到：${confirmableAction.recipients.map((recipient) => formatRecipient(recipient)).join('、')}`,
                `主题：${confirmableAction.subject}`,
            ];
            return addPrefixMessage(lines.join('\n'), combinedConfirmWarning);
        } catch (error) {
            stateStore.updateActiveAction({
                lastError: error.message,
            });

            const message = [
                '【发送失败】',
                error.message,
                '草稿已保留。你可以回复“修改……”后重试，或回复“取消发送”结束。',
            ].join('\n');
            return addPrefixMessage(message, combinedConfirmWarning);
        }
    }

    if (!activeAction) {
        return addPrefixMessage('当前没有待确认的邮件草稿。请先发起一封邮件。', warningMessage);
    }

    if (isCancelCommand(text)) {
        stateStore.cancelActiveAction('cancelled_by_user');
        return addPrefixMessage('【已取消】\n待发送草稿已取消。', warningMessage);
    }

    if (isShowDraftCommand(text)) {
        return addPrefixMessage(buildDraftPreview(activeAction), warningMessage);
    }

    const modification = parseDraftModification(text, groupStore);
    if (!modification) {
        return addPrefixMessage('当前草稿正在等待确认。你可以回复“确认发送”、“取消发送”，或“修改主题为…… / 修改正文为…… / 收件人改成……”。', warningMessage);
    }

    if (modification.pendingGroupTarget) {
        stateStore.setPendingGroupSelection(
            buildPendingGroupSelectionPayload(modification.pendingGroupTarget, {
                type: 'update_active_action',
                activeActionId: activeAction.id,
            })
        );

        return addPrefixMessage(
            buildGroupCandidatesPrompt({
                requestedGroupName: modification.pendingGroupTarget.requestedGroupName,
                candidates: modification.pendingGroupTarget.candidates,
                intentLabel: '发给',
            }),
            warningMessage
        );
    }

    const updatedAction = stateStore.updateActiveAction(modification);
    return addPrefixMessage(buildDraftPreview(updatedAction, '【草稿已更新】'), warningMessage);
}

function buildGroupRecipients(group) {
    if (!Array.isArray(group.members) || group.members.length === 0) {
        throw new Error(`群组“${group.name}”为空，不能发信。`);
    }

    return {
        recipients: group.members.map((member) => ({
            name: member.name,
            email: member.email,
        })),
        delivery: {
            mode: 'group',
            groupName: group.name,
        },
    };
}

function findCandidateByName(candidates, providedName) {
    const normalizedProvidedName = groupStore.normalizeGroupName(providedName);

    return (
        candidates.find((candidate) => candidate.name === normalizeName(providedName)) ||
        candidates.find((candidate) => groupStore.normalizeGroupName(candidate.name) === normalizedProvidedName) ||
        null
    );
}

async function handleConfirmGroupSelection(groupName, selection, warningMessage) {
    if (!selection) {
        return addPrefixMessage('当前没有待确认的群组候选。', warningMessage);
    }

    const chosenCandidate = findCandidateByName(selection.candidates || [], groupName);
    if (!chosenCandidate) {
        const candidateNames = (selection.candidates || []).map((candidate) => candidate.name).join('、') || '无';
        return addPrefixMessage(`候选群组中没有“${normalizeName(groupName)}”。当前候选：${candidateNames}。`, warningMessage);
    }

    const chosenGroupMatch = groupStore.findGroupMatch(chosenCandidate.name);
    if (!chosenGroupMatch.group) {
        stateStore.clearPendingGroupSelection('missing_group');
        return addPrefixMessage('待确认的群组候选已失效，请重新发起。', warningMessage);
    }

    const resolvedGroup = buildGroupRecipients(chosenGroupMatch.group);

    if (selection.intent && selection.intent.type === 'update_active_action') {
        const { action: activeAction } = stateStore.getActiveAction();
        if (!activeAction || activeAction.id !== selection.intent.activeActionId) {
            stateStore.clearPendingGroupSelection('stale_action');
            return addPrefixMessage('原始草稿已变化，请重新指定收件人。', warningMessage);
        }

        const updatedAction = stateStore.updateActiveAction({
            recipients: resolvedGroup.recipients,
            delivery: resolvedGroup.delivery,
        });
        stateStore.clearPendingGroupSelection('resolved');
        return addPrefixMessage(buildDraftPreview(updatedAction, '【草稿已更新】'), warningMessage);
    }

    if (!selection.intent || selection.intent.type !== 'create_pending_action') {
        stateStore.clearPendingGroupSelection('invalid_intent');
        return addPrefixMessage('群组确认状态异常，请重新发起发送。', warningMessage);
    }

    const payload = buildPendingPayload({
        recipients: resolvedGroup.recipients,
        delivery: resolvedGroup.delivery,
        subject: selection.intent.payload.subject,
        body: selection.intent.payload.body,
        source: selection.intent.payload.source,
    });

    const pendingResult = stateStore.createPendingAction(payload);
    return buildPendingPreviewResponse(pendingResult, warningMessage);
}

async function handleUserRequest(input) {
    const text = String(input || '').trim();
    if (!text) {
        return '请输入要处理的邮件请求。';
    }

    if (isReadIntent(text)) {
        return handleReadRequest(text);
    }

    const { action: activeAction, warning } = stateStore.getActiveAction();
    const { selection: pendingGroupSelection, warning: groupSelectionWarning } = stateStore.getPendingGroupSelection();
    const combinedWarning = joinWarnings(warning, groupSelectionWarning);
    const confirmGroupName = parseConfirmGroupCommand(text);
    if (confirmGroupName) {
        return handleConfirmGroupSelection(confirmGroupName, pendingGroupSelection, combinedWarning);
    }

    if (isConfirmCommand(text) || isCancelCommand(text) || isShowDraftCommand(text) || /^(?:修改|主题改|正文改|内容改|收件人改)/u.test(text)) {
        return handlePendingCommand(text, activeAction, combinedWarning);
    }

    const templateCreate = parseTemplateCreateRequest(text);
    if (templateCreate) {
        const template = templateStore.createTemplate({
            ...templateCreate,
            variables: collectTemplateVariables(templateCreate.subjectTemplate, templateCreate.bodyTemplate),
        });

        const lines = [
            '【创建模板成功】',
            `已保存模板“${template.name}”。`,
            '可直接说：用“模板名”模板给某人发邮件。',
        ];
        return addPrefixMessage(lines.join('\n'), combinedWarning);
    }

    if (/^(?:查看所有模板|查看全部模板|模板列表|查看模板列表)$/u.test(text)) {
        return addPrefixMessage(formatTemplateList(templateStore.listTemplates()), combinedWarning);
    }

    if (/查看.*模板/u.test(text)) {
        const templateName = parseTemplateNameCommand(text, '查看');
        if (!templateName) {
            return addPrefixMessage('请告诉我你要查看哪个模板。', combinedWarning);
        }

        const template = templateStore.getTemplateByName(templateName);
        if (!template) {
            return addPrefixMessage(`模板“${normalizeName(templateName)}”不存在。`, combinedWarning);
        }

        return addPrefixMessage(formatTemplateDetail(template), combinedWarning);
    }

    if (/删除.*模板/u.test(text)) {
        const templateName = parseTemplateNameCommand(text, '删除');
        if (!templateName) {
            return addPrefixMessage('请告诉我你要删除哪个模板。', combinedWarning);
        }

        const deletedTemplate = templateStore.deleteTemplate(templateName);
        if (!deletedTemplate) {
            return addPrefixMessage(`模板“${normalizeName(templateName)}”不存在。`, combinedWarning);
        }

        return addPrefixMessage(`【删除模板成功】\n已删除模板“${deletedTemplate.name}”。`, combinedWarning);
    }

    const groupCreate = parseGroupCreateRequest(text);
    if (groupCreate) {
        const parsedMembers = parseRecipientList(groupCreate.membersText);
        if (parsedMembers.invalidTokens.length > 0) {
            return addPrefixMessage(`以下成员格式无法识别：${parsedMembers.invalidTokens.join('、')}。请使用 姓名<email> 或 email。`, combinedWarning);
        }

        const group = groupStore.createGroup({
            name: groupCreate.name,
            members: parsedMembers.recipients,
        });

        return addPrefixMessage(`【创建群组成功】\n已保存群组“${group.name}”，共 ${group.members.length} 位成员。`, combinedWarning);
    }

    if (/^(?:查看所有群组|查看全部群组|群组列表|查看群组列表)$/u.test(text)) {
        return addPrefixMessage(formatGroupList(groupStore.listGroups()), combinedWarning);
    }

    if (/查看.*群组/u.test(text)) {
        const groupName = extractFirstQuotedValue(text) || parseTemplateNameCommand(text, '查看');
        if (!groupName) {
            return addPrefixMessage('请告诉我你要查看哪个群组。', combinedWarning);
        }

        const groupResolution = resolveGroupCommandMatch(groupName);
        if (!groupResolution.group) {
            return addPrefixMessage(groupResolution.message, combinedWarning);
        }

        return addPrefixMessage(formatGroupDetail(groupResolution.group), combinedWarning);
    }

    const addMemberRequest = parseGroupMemberAddRequest(text);
    if (addMemberRequest) {
        const parsedMember = parseRecipientList(addMemberRequest.memberText);
        if (parsedMember.invalidTokens.length > 0 || parsedMember.recipients.length !== 1) {
            return addPrefixMessage('请提供一个成员，格式如：王五<wuwu@example.com>。', combinedWarning);
        }

        const groupResolution = resolveGroupCommandMatch(addMemberRequest.groupName);
        if (!groupResolution.group) {
            return addPrefixMessage(groupResolution.message, combinedWarning);
        }

        const group = groupStore.addMember(groupResolution.group.name, parsedMember.recipients[0]);
        return addPrefixMessage(`【添加成员成功】\n已将 ${formatRecipient(parsedMember.recipients[0])} 加入群组“${group.name}”。`, combinedWarning);
    }

    const removeMemberRequest = parseGroupMemberRemoveRequest(text);
    if (removeMemberRequest) {
        const groupResolution = resolveGroupCommandMatch(removeMemberRequest.groupName);
        if (!groupResolution.group) {
            return addPrefixMessage(groupResolution.message, combinedWarning);
        }

        const result = groupStore.removeMember(groupResolution.group.name, removeMemberRequest.memberIdentifier);
        return addPrefixMessage(`【移除成员成功】\n已将 ${formatRecipient(result.removedMember)} 从群组“${result.group.name}”中删除。`, combinedWarning);
    }

    if (/删除.*群组/u.test(text)) {
        const groupName = extractFirstQuotedValue(text) || parseTemplateNameCommand(text, '删除');
        if (!groupName) {
            return addPrefixMessage('请告诉我你要删除哪个群组。', combinedWarning);
        }

        const groupResolution = resolveGroupCommandMatch(groupName);
        if (!groupResolution.group) {
            return addPrefixMessage(groupResolution.message, combinedWarning);
        }

        const deletedGroup = groupStore.deleteGroup(groupResolution.group.name);
        if (!deletedGroup) {
            return addPrefixMessage(`群组“${normalizeName(groupName)}”不存在。`, combinedWarning);
        }

        return addPrefixMessage(`【删除群组成功】\n已删除群组“${deletedGroup.name}”。`, combinedWarning);
    }

    const templateSend = parseTemplateSendRequest(text);
    if (templateSend) {
        const rendered = templateStore.renderTemplate(templateSend.templateName, templateSend.variables);
        if (!rendered) {
            return addPrefixMessage(`模板“${normalizeName(templateSend.templateName)}”不存在。`, combinedWarning);
        }

        if (rendered.missingVariables.length > 0) {
            return addPrefixMessage(`模板变量缺失：${rendered.missingVariables.join('、')}。请补充变量后重试。`, combinedWarning);
        }

        const resolvedRecipients = resolveRecipientTarget(templateSend.targetText, groupStore);
        if (resolvedRecipients.requiresGroupConfirmation) {
            stateStore.setPendingGroupSelection(
                buildPendingGroupSelectionPayload(resolvedRecipients, {
                    type: 'create_pending_action',
                    payload: {
                        subject: rendered.subject,
                        body: rendered.body,
                        source: {
                            kind: 'template_manual',
                            templateName: rendered.template.name,
                            variables: templateSend.variables,
                        },
                    },
                })
            );

            return addPrefixMessage(
                buildGroupCandidatesPrompt({
                    requestedGroupName: resolvedRecipients.requestedGroupName,
                    candidates: resolvedRecipients.candidates,
                    intentLabel: '发给',
                }),
                combinedWarning
            );
        }

        const payload = buildPendingPayload({
            recipients: resolvedRecipients.recipients,
            delivery: resolvedRecipients.delivery,
            subject: rendered.subject,
            body: rendered.body,
            source: {
                kind: 'template_manual',
                templateName: rendered.template.name,
                variables: templateSend.variables,
            },
        });

        const pendingResult = stateStore.createPendingAction(payload);
        return buildPendingPreviewResponse(pendingResult, combinedWarning);
    }

    const directSend = parseDirectSendRequest(text);
    if (directSend) {
        const autoTemplateDraft = buildAutoTemplateDraft(
            [directSend.requestText, directSend.subject, directSend.body].filter(Boolean).join('\n'),
            parseVariableAssignments(text)
        );
        const resolvedRecipients = resolveRecipientTarget(directSend.targetText, groupStore);
        if (resolvedRecipients.requiresGroupConfirmation) {
            stateStore.setPendingGroupSelection(
                buildPendingGroupSelectionPayload(resolvedRecipients, {
                    type: 'create_pending_action',
                    payload: {
                        subject: autoTemplateDraft ? autoTemplateDraft.subject : directSend.subject,
                        body: autoTemplateDraft ? autoTemplateDraft.body : directSend.body,
                        source: autoTemplateDraft ? autoTemplateDraft.source : {
                            kind: 'direct',
                        },
                    },
                })
            );

            return addPrefixMessage(
                buildGroupCandidatesPrompt({
                    requestedGroupName: resolvedRecipients.requestedGroupName,
                    candidates: resolvedRecipients.candidates,
                    intentLabel: '发给',
                }),
                combinedWarning
            );
        }

        const payload = buildPendingPayload({
            recipients: resolvedRecipients.recipients,
            delivery: resolvedRecipients.delivery,
            subject: autoTemplateDraft ? autoTemplateDraft.subject : directSend.subject,
            body: autoTemplateDraft ? autoTemplateDraft.body : directSend.body,
            source: autoTemplateDraft ? autoTemplateDraft.source : {
                kind: 'direct',
            },
        });

        const pendingResult = stateStore.createPendingAction(payload);
        return buildPendingPreviewResponse(pendingResult, combinedWarning);
    }

    const genericName = extractFirstQuotedValue(text);
    if (genericName) {
        const group = groupStore.getGroupByName(genericName);
        if (group) {
            return addPrefixMessage(formatGroupDetail(group), combinedWarning);
        }

        const template = templateStore.getTemplateByName(genericName);
        if (template) {
            return addPrefixMessage(formatTemplateDetail(template), combinedWarning);
        }
    }

    return addPrefixMessage('暂时没识别到你的邮件意图。你可以让我管理模板、群组、草稿确认，或读取邮件。', combinedWarning);
}

async function main() {
    const input = process.argv.slice(2).join(' ').trim();
    if (!input) {
        console.log('Usage: node email-assistant.js "<你的邮件请求>"');
        process.exit(1);
    }

    try {
        const result = await handleUserRequest(input);
        console.log(result);
    } catch (error) {
        if (error instanceof StoreFileError) {
            console.log(`【数据文件错误】\n${error.message}`);
            process.exit(1);
        }

        console.log(`【处理失败】\n${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    handleUserRequest,
};
