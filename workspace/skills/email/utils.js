const fs = require('fs');
const path = require('path');

class StoreFileError extends Error {
    constructor(message, filePath, code = 'STORE_FILE_ERROR') {
        super(message);
        this.name = 'StoreFileError';
        this.filePath = filePath;
        this.code = code;
    }
}

function cloneJsonValue(value) {
    return JSON.parse(JSON.stringify(value));
}

function ensureJsonFile(filePath, defaultValue) {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `${JSON.stringify(defaultValue, null, 2)}\n`, 'utf8');
    }
}

function readJsonFile(filePath, defaultValue) {
    ensureJsonFile(filePath, defaultValue);

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        throw new StoreFileError(
            `数据文件 ${path.basename(filePath)} 已损坏，请修复 JSON 格式后重试。`,
            filePath,
            'STORE_FILE_CORRUPTED'
        );
    }
}

function writeJsonFile(filePath, data) {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });

    try {
        fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch (error) {
        throw new StoreFileError(
            `写入数据文件 ${path.basename(filePath)} 失败。`,
            filePath,
            'STORE_FILE_WRITE_FAILED'
        );
    }
}

function nowIsoString() {
    return new Date().toISOString();
}

function generateId(prefix = 'item') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripWrappingQuotes(value) {
    let result = String(value || '').trim();
    const pairs = [
        ['"', '"'],
        ['\'', '\''],
        ['“', '”'],
        ['‘', '’'],
    ];

    let changed = true;
    while (changed && result.length >= 2) {
        changed = false;
        for (const [start, end] of pairs) {
            if (result.startsWith(start) && result.endsWith(end)) {
                result = result.slice(start.length, result.length - end.length).trim();
                changed = true;
            }
        }
    }

    return result;
}

function normalizeName(value) {
    return stripWrappingQuotes(String(value || '').trim());
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidEmail(value) {
    const email = String(value || '').trim();
    return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(email);
}

function parseNameEmailToken(token) {
    const cleaned = stripWrappingQuotes(
        String(token || '')
            .trim()
            .replace(/^[，,、；;\s]+/u, '')
            .replace(/[，,、；;\s]+$/u, '')
    );

    if (!cleaned) {
        return null;
    }

    const namedMatch = cleaned.match(/^(.+?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>$/u);
    if (namedMatch) {
        const [, name, email] = namedMatch;
        const normalizedEmail = email.trim();
        if (!isValidEmail(normalizedEmail)) {
            return null;
        }

        return {
            name: stripWrappingQuotes(name.trim()),
            email: normalizedEmail,
        };
    }

    if (isValidEmail(cleaned)) {
        return {
            name: '',
            email: cleaned,
        };
    }

    return null;
}

function parseRecipientList(input) {
    const text = String(input || '').trim();
    if (!text) {
        return {
            recipients: [],
            invalidTokens: [],
        };
    }

    const tokens = text
        .split(/[、，,；;\n]+/u)
        .map((token) => token.trim())
        .filter(Boolean);

    const recipients = [];
    const invalidTokens = [];
    const seenEmails = new Set();

    for (const token of tokens) {
        const parsed = parseNameEmailToken(token);
        if (!parsed) {
            invalidTokens.push(token);
            continue;
        }

        if (seenEmails.has(parsed.email)) {
            continue;
        }

        seenEmails.add(parsed.email);
        recipients.push(parsed);
    }

    return {
        recipients,
        invalidTokens,
    };
}

function formatRecipient(recipient) {
    if (!recipient) {
        return '';
    }

    if (recipient.name && recipient.name !== recipient.email) {
        return `${recipient.name} <${recipient.email}>`;
    }

    return recipient.email;
}

function formatNumberedRecipients(recipients) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
        return '无';
    }

    return recipients
        .map((recipient, index) => `${index + 1}. ${formatRecipient(recipient)}`)
        .join('\n');
}

function collectTemplateVariables(...texts) {
    const variables = new Set();
    const pattern = /\{\{\s*([^{}\s]+)\s*\}\}/gu;

    for (const text of texts) {
        if (!isNonEmptyString(text)) {
            continue;
        }

        let match;
        while ((match = pattern.exec(text)) !== null) {
            variables.add(match[1]);
        }
    }

    return Array.from(variables);
}

function renderTemplateText(templateText, variables = {}) {
    const missing = new Set();

    const rendered = String(templateText || '').replace(/\{\{\s*([^{}\s]+)\s*\}\}/gu, (_, key) => {
        if (!Object.prototype.hasOwnProperty.call(variables, key)) {
            missing.add(key);
            return `{{${key}}}`;
        }

        const value = variables[key];
        if (value === null || value === undefined || String(value).trim() === '') {
            missing.add(key);
            return `{{${key}}}`;
        }

        return String(value);
    });

    return {
        rendered,
        missingVariables: Array.from(missing),
    };
}

function addPrefixMessage(message, prefix) {
    if (!prefix) {
        return message;
    }

    return `${prefix}\n\n${message}`;
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/\{\{\s*[^{}]+\s*\}\}/gu, ' ')
        .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function extractKeywordTerms(value) {
    const normalized = normalizeSearchText(value);
    if (!normalized) {
        return [];
    }

    const stopTerms = new Set([
        '发邮件',
        '发送邮件',
        '写邮件',
        '寄邮件',
        '邮件',
        '邮箱',
        '收件人',
        '主题',
        '正文',
        '内容',
        '给',
        '发给',
        '请',
        '帮我',
        '帮忙',
        '一下',
        '一下子',
        '一个',
        '这个',
        '那个',
        '我们',
        '你们',
        '他们',
        '今天',
        '明天',
    ]);

    const terms = new Set();
    const chunks = normalized.split(/\s+/u).filter(Boolean);

    for (const chunk of chunks) {
        if (/^[\p{Script=Han}]+$/u.test(chunk)) {
            if (!stopTerms.has(chunk) && chunk.length >= 2) {
                terms.add(chunk);
            }

            for (let size = 2; size <= Math.min(4, chunk.length); size += 1) {
                for (let index = 0; index <= chunk.length - size; index += 1) {
                    const term = chunk.slice(index, index + size);
                    if (!stopTerms.has(term)) {
                        terms.add(term);
                    }
                }
            }
            continue;
        }

        if (chunk.length >= 2 && !stopTerms.has(chunk)) {
            terms.add(chunk);
        }
    }

    return Array.from(terms);
}

module.exports = {
    StoreFileError,
    addPrefixMessage,
    cloneJsonValue,
    collectTemplateVariables,
    ensureJsonFile,
    extractKeywordTerms,
    formatNumberedRecipients,
    formatRecipient,
    generateId,
    isNonEmptyString,
    isValidEmail,
    normalizeName,
    normalizeSearchText,
    nowIsoString,
    parseNameEmailToken,
    parseRecipientList,
    readJsonFile,
    renderTemplateText,
    stripWrappingQuotes,
    writeJsonFile,
};
