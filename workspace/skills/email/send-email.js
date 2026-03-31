#!/usr/bin/env node
/**
 * Email sending tool for OpenClaw with SMTP support via nodemailer
 *
 * Usage:
 *   node send-email.js <to> <subject> <body> [from]
 *
 * Configuration via skills/email/email-config.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// Try to load nodemailer
let nodemailer;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    console.error('Error: nodemailer not installed. Run: npm install nodemailer');
    process.exit(1);
}

// Config file path
const CONFIG_PATH = path.join(__dirname, 'email-config.json');

function loadConfig() {
    const config = {
        smtp: {
            host: process.env.EMAIL_SMTP_HOST,
            port: parseInt(process.env.EMAIL_SMTP_PORT) || 587,
            user: process.env.EMAIL_SMTP_USER,
            pass: process.env.EMAIL_SMTP_PASS,
            secure: false, // true for 465, false for other ports
        },
        from: process.env.EMAIL_FROM || `${process.env.USER || os.userInfo().username}@${os.hostname()}`
    };

    // Override with config file if exists
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (fileConfig.smtp) {
                Object.assign(config.smtp, fileConfig.smtp);
                // Auto-set secure based on port
                if (fileConfig.smtp.port === 465) {
                    config.smtp.secure = true;
                }
            }
            if (fileConfig.from) {
                config.from = fileConfig.from;
            }
        } catch (e) {
            console.error('Warning: Failed to parse config file:', e.message);
        }
    }

    return config;
}

async function sendEmailSMTP(to, subject, body, from, config) {
    if (!config.smtp.host || !config.smtp.user || !config.smtp.pass) {
        throw new Error('SMTP not configured. Please set host, user, and pass in email-config.json');
    }

    const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
            user: config.smtp.user,
            pass: config.smtp.pass,
        },
        tls: {
            // Do not fail on invalid certs (useful for some providers)
            rejectUnauthorized: false
        }
    });

    // Verify connection
    await transporter.verify();

    const info = await transporter.sendMail({
        from: from || config.from,
        to: to,
        subject: subject,
        text: body,
        // html alternative can be added here if needed
    });

    await transporter.close();

    return {
        success: true,
        messageId: info.messageId,
        method: 'smtp'
    };
}

async function sendEmailSystem(to, subject, body, from) {
    const emailContent = `From: ${from}
To: ${to}
Subject: ${subject}
Content-Type: text/plain; charset=UTF-8

${body}`;

    const sendmailResult = spawnSync('sendmail', [to], {
        input: emailContent,
        encoding: 'utf8',
    });

    if (!sendmailResult.error && sendmailResult.status === 0) {
        return { success: true, method: 'sendmail' };
    }

    const mailResult = spawnSync('mail', ['-s', subject, to], {
        input: body,
        encoding: 'utf8',
    });

    if (!mailResult.error && mailResult.status === 0) {
        return { success: true, method: 'mail' };
    }

    if (sendmailResult.error && sendmailResult.error.code !== 'ENOENT') {
        throw new Error(sendmailResult.error.message);
    }

    if (mailResult.error && mailResult.error.code !== 'ENOENT') {
        throw new Error(mailResult.error.message);
    }

    if (sendmailResult.status && sendmailResult.stderr) {
        throw new Error(sendmailResult.stderr.trim());
    }

    if (mailResult.status && mailResult.stderr) {
        throw new Error(mailResult.stderr.trim());
    }

    throw new Error('No mail sending tool available');
}

async function sendEmail(options) {
    const { to, subject, body, from: fromArg, config: configArg } = options || {};

    if (!to || !subject || !body) {
        throw new Error('to, subject, and body are required');
    }

    const config = configArg || loadConfig();
    const from = fromArg || config.from;

    if (config.smtp.host && config.smtp.user && config.smtp.pass) {
        try {
            return await sendEmailSMTP(to, subject, body, from, config);
        } catch (smtpError) {
            return sendEmailSystem(to, subject, body, from);
        }
    }

    return sendEmailSystem(to, subject, body, from);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.log('Usage: node send-email.js <to> <subject> <body> [from]');
        console.log('');
        console.log('Configuration file: email-config.json');
        process.exit(1);
    }

    const [to, subject, body, fromArg] = args;
    try {
        const config = loadConfig();
        const from = fromArg || config.from;
        const result = await sendEmail({
            to,
            subject,
            body,
            from,
            config,
        });

        console.log(JSON.stringify({
            success: true,
            to,
            subject,
            from,
            method: result.method,
            messageId: result.messageId
        }, null, 2));
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
    loadConfig,
    sendEmail,
    sendEmailSMTP,
    sendEmailSystem,
};
