/**
 * 将常见 Markdown 转成更适合邮件阅读的纯文本（弱化「排版符号感」）
 * 仅用于发信；落盘的 .md 文件仍保持原样。
 */

function normalizeNewlines(s) {
  return (s || '').replace(/\r\n/g, '\n');
}

function stripFencedCode(t) {
  return t.replace(/^```[\w]*\n([\s\S]*?)\n```/gm, (_, body) =>
    body
      .split('\n')
      .map((line) => (line.length ? `    ${line}` : line))
      .join('\n')
  );
}

function stripInlineFormatting(t) {
  let s = t.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）');
  // 单行内成对的斜体（列表行已先处理过，此处多为强调）
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
  s = s.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');
  return s;
}

function transformLine(line) {
  const hr = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
  if (hr.test(line)) return '';

  const head = line.match(/^(\s*)(#{1,6})\s*(.+)$/);
  if (head && head[3].trim()) return `${head[1]}${head[3].trim()}`;

  const bq = line.match(/^(\s*)>\s?(.*)$/);
  if (bq) return `${bq[1]}${bq[2]}`;

  const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (ol) return `${ol[1]}${ol[2]}）${ol[3]}`;

  const ul = line.match(/^(\s*)[-*+]\s+(\[[ xX]\]\s*)?(.*)$/);
  if (ul) {
    const check = ul[2] || '';
    let bullet = '· ';
    if (/\[x\]/i.test(check)) bullet = '☑ ';
    else if (/\[ \]/.test(check)) bullet = '☐ ';
    return `${ul[1]}${bullet}${ul[3]}`;
  }

  return line;
}

/**
 * 去掉行内任意位置的 ATX 标题符（如列表摘录里带的「## 计划安排」）
 * 只处理 # 后接空白的情况，避免误伤 URL fragment、话题标签 #词
 */
function stripEmbeddedAtxHeadings(t) {
  let s = t;
  let prev;
  do {
    prev = s;
    s = s.replace(/\s+#{1,6}\s+/g, ' ');
  } while (s !== prev);
  // 「##计划」无空格类
  s = s.replace(/\s+#{1,6}(?=[\u4e00-\u9fa5A-Za-z])/g, ' ');
  s = s.replace(/\s+#{1,6}$/gm, '');
  return s;
}

/** 话题标签 #中文 / #english（前面是空白/行首/括号/常见中文标点，避免误伤 URL 的 #fragment） */
function softenHashtags(t) {
  return t.replace(
    /(^|[\s\u3000（(，。：、；])#([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_-]*)/gm,
    '$1「$2」'
  );
}

/**
 * @param {string} raw
 * @returns {string}
 */
function toEmailPlainText(raw) {
  let t = normalizeNewlines(raw);
  t = stripFencedCode(t);
  t = stripInlineFormatting(t);
  t = t
    .split('\n')
    .map(transformLine)
    .join('\n');
  t = stripEmbeddedAtxHeadings(t);
  t = softenHashtags(t);
  t = t.replace(/\n{4,}/g, '\n\n\n');
  return t.trim();
}

module.exports = { toEmailPlainText };
