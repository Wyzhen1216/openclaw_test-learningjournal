#!/usr/bin/env node
/**
 * Email reading tool for OpenClaw with IMAP support via imap-simple
 *
 * Usage:
 *   node read-email.js [limit|uid]
 *   node read-email.js --since "2026-03-18 16:50"  // read emails after specific time
 *   node read-email.js --uid 4  // read specific email by UID
 *
 * Configuration via skills/email/email-config.json
 */

const fs = require('fs');
const path = require('path');

// Config file path
const CONFIG_PATH = path.join(__dirname, 'email-config.json');

function loadConfig() {
    const config = {
        imap: {
            host: process.env.EMAIL_IMAP_HOST,
            port: parseInt(process.env.EMAIL_IMAP_PORT) || 993,
            user: process.env.EMAIL_IMAP_USER,
            pass: process.env.EMAIL_IMAP_PASS,
            tls: true
        }
    };

    // Override with config file if exists
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (fileConfig.imap) {
                Object.assign(config.imap, fileConfig.imap);
            }
        } catch (e) {
            console.error('Warning: Failed to parse config file:', e.message);
        }
    }

    return config;
}

function decodeBase64(str) {
    try {
        return Buffer.from(str, 'base64').toString('utf8');
    } catch (e) {
        return str;
    }
}

function extractTextFromMime(body) {
    if (!body) return '(无内容)';
    
    // Try to find base64 encoded text/plain part
    const base64Match = body.match(/Content-Type: text\/plain[^]*?Content-Transfer-Encoding: base64[^]*?\n\n([A-Za-z0-9+/=\s]+)/i);
    if (base64Match) {
        return decodeBase64(base64Match[1].replace(/\s/g, ''));
    }
    
    // Try to find quoted-printable text/plain part
    const qpMatch = body.match(/Content-Type: text\/plain[^]*?Content-Transfer-Encoding: quoted-printable[^]*?\n\n([\s\S]+?)(?:\n--|$)/i);
    if (qpMatch) {
        return qpMatch[1].replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/=\n/g, '');
    }
    
    // Return raw body if no encoding found
    return body.substring(0, 5000);
}

function requireImapSimple() {
    try {
        return require('imap-simple');
    } catch (error) {
        throw new Error('imap-simple not installed. Run: npm install');
    }
}

async function readEmails(config, limit = 10) {
    if (!config.imap.host || !config.imap.user || !config.imap.pass) {
        throw new Error('IMAP not configured. Please set host, user, and pass in email-config.json');
    }

    const imaps = requireImapSimple();

    const connectionConfig = {
        imap: {
            user: config.imap.user,
            password: config.imap.pass,
            host: config.imap.host,
            port: config.imap.port || 993,
            tls: config.imap.tls !== false,
            authTimeout: 3000
        }
    };

    const connection = await imaps.connect(connectionConfig);
    await connection.openBox('INBOX');

    // Search for all emails
    const searchCriteria = ['ALL'];
    const fetchOptions = {
        bodies: ['HEADER', 'TEXT'],
        struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    
    // Sort by date descending and limit
    const limitedMessages = messages.slice(-limit).reverse();

    const results = limitedMessages.map(message => {
        const header = message.parts.find(part => part.which === 'HEADER');
        const text = message.parts.find(part => part.which === 'TEXT');
        
        const headers = header ? header.body : {};
        
        return {
            uid: message.attributes.uid,
            subject: headers.subject ? headers.subject[0] : '(无主题)',
            from: headers.from ? headers.from[0] : '(未知发件人)',
            date: headers.date ? headers.date[0] : '(无日期)',
            preview: text && text.body ? text.body.substring(0, 200).replace(/\s+/g, ' ') + '...' : '(无内容预览)'
        };
    });

    await connection.end();
    return results;
}

async function readEmailByUid(config, uid) {
    if (!config.imap.host || !config.imap.user || !config.imap.pass) {
        throw new Error('IMAP not configured. Please set host, user, and pass in email-config.json');
    }

    const imaps = requireImapSimple();

    const connectionConfig = {
        imap: {
            user: config.imap.user,
            password: config.imap.pass,
            host: config.imap.host,
            port: config.imap.port || 993,
            tls: config.imap.tls !== false,
            authTimeout: 3000
        }
    };

    const connection = await imaps.connect(connectionConfig);
    await connection.openBox('INBOX');

    const searchCriteria = [['UID', uid.toString()]];
    const fetchOptions = {
        bodies: ['HEADER', 'TEXT'],
        struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    
    if (messages.length === 0) {
        await connection.end();
        throw new Error(`Email with UID ${uid} not found`);
    }

    const message = messages[0];
    const header = message.parts.find(part => part.which === 'HEADER');
    const text = message.parts.find(part => part.which === 'TEXT');
    
    const headers = header ? header.body : {};
    const fullBody = text ? text.body : '';
    
    const result = {
        uid: message.attributes.uid,
        subject: headers.subject ? headers.subject[0] : '(无主题)',
        from: headers.from ? headers.from[0] : '(未知发件人)',
        to: headers.to ? headers.to[0] : '',
        date: headers.date ? headers.date[0] : '(无日期)',
        content: extractTextFromMime(fullBody),
        rawBody: fullBody.substring(0, 2000) // Keep some raw for debugging
    };

    await connection.end();
    return result;
}

async function readEmailsSince(config, sinceDate) {
    if (!config.imap.host || !config.imap.user || !config.imap.pass) {
        throw new Error('IMAP not configured. Please set host, user, and pass in email-config.json');
    }

    const imaps = requireImapSimple();

    const connectionConfig = {
        imap: {
            user: config.imap.user,
            password: config.imap.pass,
            host: config.imap.host,
            port: config.imap.port || 993,
            tls: config.imap.tls !== false,
            authTimeout: 3000
        }
    };

    const connection = await imaps.connect(connectionConfig);
    await connection.openBox('INBOX');

    // Parse date and create search criteria
    const date = new Date(sinceDate);
    const searchCriteria = [['SINCE', date.toUTCString().replace(/ \d{2}:\d{2}:\d{2} GMT/, '')]];
    
    const fetchOptions = {
        bodies: ['HEADER', 'TEXT'],
        struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    
    // Filter by exact time
    const filteredMessages = messages.filter(message => {
        const header = message.parts.find(part => part.which === 'HEADER');
        if (header && header.body.date) {
            const emailDate = new Date(header.body.date[0]);
            return emailDate >= date;
        }
        return false;
    });

    const results = filteredMessages.map(message => {
        const header = message.parts.find(part => part.which === 'HEADER');
        const text = message.parts.find(part => part.which === 'TEXT');
        
        const headers = header ? header.body : {};
        const fullBody = text ? text.body : '';
        
        return {
            uid: message.attributes.uid,
            subject: headers.subject ? headers.subject[0] : '(无主题)',
            from: headers.from ? headers.from[0] : '(未知发件人)',
            to: headers.to ? headers.to[0] : '',
            date: headers.date ? headers.date[0] : '(无日期)',
            content: extractTextFromMime(fullBody)
        };
    });

    await connection.end();
    return results.reverse(); // Newest first
}

// Main
async function main() {
    const args = process.argv.slice(2);
    const config = loadConfig();

    try {
        if (args[0] === '--uid' && args[1]) {
            // Read specific email
            const email = await readEmailByUid(config, args[1]);
            console.log(JSON.stringify({
                success: true,
                email: email
            }, null, 2));
        } else if (args[0] === '--since' && args[1]) {
            // Read emails since date/time
            const emails = await readEmailsSince(config, args[1]);
            console.log(JSON.stringify({
                success: true,
                count: emails.length,
                emails: emails
            }, null, 2));
        } else {
            // Default: list emails
            const limit = parseInt(args[0]) || 10;
            const emails = await readEmails(config, limit);
            console.log(JSON.stringify({
                success: true,
                count: emails.length,
                emails: emails
            }, null, 2));
        }
    } catch (error) {
        console.error(JSON.stringify({
            success: false,
            error: error.message
        }, null, 2));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    decodeBase64,
    extractTextFromMime,
    loadConfig,
    readEmailByUid,
    readEmails,
    readEmailsSince,
};
