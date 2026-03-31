const path = require('path');

const {
    StoreFileError,
    collectTemplateVariables,
    extractKeywordTerms,
    generateId,
    isNonEmptyString,
    normalizeName,
    normalizeSearchText,
    nowIsoString,
    readJsonFile,
    renderTemplateText,
    writeJsonFile,
} = require('./utils');

const TEMPLATE_PATH = path.join(__dirname, 'templates.json');
const DEFAULT_TEMPLATE_DATA = {
    version: 1,
    templates: [],
};

function loadData() {
    const data = readJsonFile(TEMPLATE_PATH, DEFAULT_TEMPLATE_DATA);

    if (!data || !Array.isArray(data.templates)) {
        throw new StoreFileError(
            'templates.json 结构无效，请检查 templates 字段是否为数组。',
            TEMPLATE_PATH,
            'STORE_FILE_INVALID'
        );
    }

    return data;
}

function saveData(data) {
    writeJsonFile(TEMPLATE_PATH, data);
}

function listTemplates() {
    const data = loadData();
    return [...data.templates].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'));
}

function getTemplateByName(name) {
    const targetName = normalizeName(name);
    if (!isNonEmptyString(targetName)) {
        return null;
    }

    const data = loadData();
    return data.templates.find((template) => template.name === targetName) || null;
}

function createTemplate({ name, subjectTemplate, bodyTemplate, variables }) {
    const templateName = normalizeName(name);
    const normalizedSubject = String(subjectTemplate || '').trim();
    const normalizedBody = String(bodyTemplate || '').trim();

    if (!isNonEmptyString(templateName)) {
        throw new Error('模板名称不能为空。');
    }

    if (!isNonEmptyString(normalizedSubject)) {
        throw new Error('模板主题不能为空。');
    }

    if (!isNonEmptyString(normalizedBody)) {
        throw new Error('模板正文不能为空。');
    }

    const data = loadData();
    if (data.templates.some((template) => template.name === templateName)) {
        throw new Error(`模板“${templateName}”已存在。`);
    }

    const now = nowIsoString();
    const detectedVariables = collectTemplateVariables(normalizedSubject, normalizedBody);
    const template = {
        id: generateId('template'),
        name: templateName,
        subjectTemplate: normalizedSubject,
        bodyTemplate: normalizedBody,
        variables: Array.isArray(variables) && variables.length > 0 ? [...new Set(variables)] : detectedVariables,
        createdAt: now,
        updatedAt: now,
    };

    data.templates.push(template);
    saveData(data);
    return template;
}

function deleteTemplate(name) {
    const templateName = normalizeName(name);
    const data = loadData();
    const index = data.templates.findIndex((template) => template.name === templateName);

    if (index === -1) {
        return null;
    }

    const [deletedTemplate] = data.templates.splice(index, 1);
    saveData(data);
    return deletedTemplate;
}

function renderTemplate(name, variables = {}) {
    const template = getTemplateByName(name);
    if (!template) {
        return null;
    }

    const subjectResult = renderTemplateText(template.subjectTemplate, variables);
    const bodyResult = renderTemplateText(template.bodyTemplate, variables);
    const missingVariables = Array.from(
        new Set([
            ...(template.variables || []),
            ...subjectResult.missingVariables,
            ...bodyResult.missingVariables,
        ])
    ).filter((key) => {
        return !Object.prototype.hasOwnProperty.call(variables, key) || String(variables[key] || '').trim() === '';
    });

    return {
        template,
        subject: subjectResult.rendered,
        body: bodyResult.rendered,
        missingVariables,
    };
}

function getMatchedTerms(requestTerms, targetText) {
    const normalizedTarget = normalizeSearchText(targetText);
    if (!normalizedTarget || requestTerms.length === 0) {
        return [];
    }

    return requestTerms.filter((term) => normalizedTarget.includes(term));
}

function getWeightedTermCoverage(requestTerms, matchedTerms) {
    const totalWeight = requestTerms.reduce((sum, term) => sum + Math.min(term.length, 4), 0) || 1;
    const matchedSet = new Set(matchedTerms);
    const matchedWeight = requestTerms.reduce((sum, term) => {
        return matchedSet.has(term) ? sum + Math.min(term.length, 4) : sum;
    }, 0);

    return matchedWeight / totalWeight;
}

function scoreTemplateMatch(template, requestText) {
    const normalizedRequest = normalizeSearchText(requestText);
    const requestTerms = extractKeywordTerms(requestText);

    if (!normalizedRequest || requestTerms.length === 0) {
        return null;
    }

    const nameText = normalizeSearchText(template.name);
    const subjectText = normalizeSearchText(template.subjectTemplate);
    const bodyText = normalizeSearchText(template.bodyTemplate);

    const nameMatches = getMatchedTerms(requestTerms, nameText);
    const subjectMatches = getMatchedTerms(requestTerms, subjectText);
    const bodyMatches = getMatchedTerms(requestTerms, bodyText);
    const matchedTerms = Array.from(new Set([...nameMatches, ...subjectMatches, ...bodyMatches]));

    let score = 0;
    if (nameText && normalizedRequest.includes(nameText)) {
        score += 0.75;
    }

    score += getWeightedTermCoverage(requestTerms, nameMatches) * 0.7;
    score += getWeightedTermCoverage(requestTerms, subjectMatches) * 0.5;
    score += getWeightedTermCoverage(requestTerms, bodyMatches) * 0.3;
    score += Math.min(matchedTerms.length, 4) * 0.08;

    if (matchedTerms.length === 0) {
        return null;
    }

    return {
        template,
        score,
        matchedTerms,
    };
}

function findBestTemplateMatch(requestText, { minScore = 0.45, relaxedMinScore = 0.22 } = {}) {
    const data = loadData();
    const scoredTemplates = data.templates
        .map((template) => scoreTemplateMatch(template, requestText))
        .filter(Boolean)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            if (right.matchedTerms.length !== left.matchedTerms.length) {
                return right.matchedTerms.length - left.matchedTerms.length;
            }

            return left.template.name.localeCompare(right.template.name, 'zh-Hans-CN');
        });

    const bestMatch = scoredTemplates[0] || null;
    if (!bestMatch) {
        return null;
    }

    if (bestMatch.score >= minScore) {
        return bestMatch;
    }

    if (bestMatch.score >= relaxedMinScore && bestMatch.matchedTerms.length >= 2) {
        return bestMatch;
    }

    return null;
}

module.exports = {
    TEMPLATE_PATH,
    createTemplate,
    deleteTemplate,
    findBestTemplateMatch,
    getTemplateByName,
    listTemplates,
    renderTemplate,
};
