import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ESC = '\u001b';
const BEL = '\u0007';
const R = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const ITALIC = `${ESC}[3m`;
const UNDER = `${ESC}[4m`;
const STRIKE = `${ESC}[9m`;
const CODE = `${ESC}[48;5;236m${ESC}[38;5;252m`;
const KBD = `${ESC}[48;5;238m${ESC}[38;5;255m`;
const MARK = `${ESC}[48;2;120;96;20m${ESC}[38;5;230m`;
const CODE_TEXT = `${ESC}[38;5;252m`;
const MARGIN = 2;

const HEADINGS = [
	{ rows: 3, scale: 2.2, tracking: -0.04 },
	{ rows: 2, scale: 1.55, tracking: -0.03, color: '#e4e4e7' },
	{ rows: 2, scale: 1.25, tracking: -0.02, color: '#e4e4e7' },
	{ rows: 1, scale: 0.9, tracking: 0, color: '#e4e4e7' },
	{ rows: 1, scale: 0.9, tracking: 0, color: '#c4c4cc' },
	{ rows: 1, scale: 0.85, tracking: 0, color: '#a1a1aa' },
	{ rows: 1, scale: 0.85, tracking: 0, color: '#a1a1aa' }
];

const INLINE_TAGS = {
	small: DIM,
	sub: DIM,
	sup: DIM,
	b: BOLD,
	strong: BOLD,
	i: ITALIC,
	em: ITALIC,
	u: UNDER,
	ins: UNDER,
	s: STRIKE,
	del: STRIKE,
	strike: STRIKE,
	mark: MARK,
	kbd: KBD,
	code: CODE
};

const statePath = resolve(process.argv[2]);
const python = process.argv[3] || 'python3';
const out = process.stdout;
const images = new Map();
const headings = new Map();
let cell = { width: 8, height: 17 };
let accent = '';
let accentHex = '#7aa2f7';
let last = null;

const raster = spawn(python, [join(dirname(fileURLToPath(import.meta.url)), 'mdpreview_raster.py')], {
	stdio: ['pipe', 'pipe', 'ignore']
});
raster.on('error', () => {});
raster.stdin.on('error', () => {});
createInterface({ input: raster.stdout }).on('line', (line) => {
	const reply = JSON.parse(line);
	headings.set(reply.key, reply.error ? { failed: true } : reply);
	if (!reply.error && last) draw(last);
});

function fg(hex) {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
	if (!match) return '';
	const n = parseInt(match[1], 16);
	return `${ESC}[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©' };

const decode = (s) =>
	s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
		if (name[0] === '#') {
			const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : all;
		}
		return ENTITIES[name.toLowerCase()] ?? all;
	});

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

function textWidth(text) {
	let width = 0;
	for (const char of text) width += WIDE.test(char) ? 2 : 1;
	return width;
}

function inlineSpans(tokens, style = '', href) {
	const spans = [];
	const stack = [];
	const active = () => style + stack.join('');
	for (const token of tokens ?? []) {
		if (token.type === 'text' || token.type === 'escape') {
			if (token.tokens?.length) spans.push(...inlineSpans(token.tokens, active(), href));
			else spans.push({ text: decode(token.text), style: active(), href });
		} else if (token.type === 'strong') {
			spans.push(...inlineSpans(token.tokens, active() + BOLD, href));
		} else if (token.type === 'em') {
			spans.push(...inlineSpans(token.tokens, active() + ITALIC, href));
		} else if (token.type === 'del') {
			spans.push(...inlineSpans(token.tokens, active() + STRIKE, href));
		} else if (token.type === 'codespan') {
			spans.push({ text: ` ${decode(token.text)} `, style: active() + CODE, href });
		} else if (token.type === 'br') {
			spans.push({ text: '\n', style: '' });
		} else if (token.type === 'link') {
			spans.push(...inlineSpans(token.tokens, active() + accent + UNDER, token.href));
		} else if (token.type === 'image') {
			spans.push({ text: `[${token.text || 'image'}]`, style: active() + DIM, href });
		} else if (token.type === 'html') {
			const tag = /^<(\/?)([a-z][a-z0-9]*)/i.exec(token.raw.trim());
			if (!tag) continue;
			const name = tag[2].toLowerCase();
			if (name === 'br') spans.push({ text: '\n', style: '' });
			else if (tag[1]) stack.pop();
			else if (INLINE_TAGS[name]) stack.push(INLINE_TAGS[name]);
		} else if (token.tokens) {
			spans.push(...inlineSpans(token.tokens, active(), href));
		} else if (token.text) {
			spans.push({ text: decode(token.text), style: active(), href });
		}
	}
	return spans;
}

function units(spans) {
	const list = [];
	for (const span of spans) {
		for (const part of span.text.split(/(\n| +)/)) {
			if (!part) continue;
			const piece = { ...span, text: part };
			const kind = part === '\n' ? 'newline' : /^ +$/.test(part) ? 'space' : 'word';
			const previous = list.at(-1);
			if (kind === 'word' && previous?.kind === 'word') {
				previous.pieces.push(piece);
				previous.width += textWidth(part);
			} else {
				list.push({ kind, pieces: [piece], width: kind === 'newline' ? 0 : textWidth(part) });
			}
		}
	}
	return list;
}

function splitWord(unit, width) {
	const chunks = [];
	let chunk = [];
	let used = 0;
	for (const piece of unit.pieces) {
		let text = '';
		for (const char of piece.text) {
			const size = textWidth(char);
			if (used + size > width && used > 0) {
				if (text) chunk.push({ ...piece, text });
				chunks.push({ kind: 'word', pieces: chunk, width: used });
				chunk = [];
				text = '';
				used = 0;
			}
			text += char;
			used += size;
		}
		if (text) chunk.push({ ...piece, text });
	}
	if (chunk.length) chunks.push({ kind: 'word', pieces: chunk, width: used });
	return chunks;
}

function wrapSpans(spans, width) {
	const lines = [[]];
	let used = 0;
	const trim = () => {
		const line = lines.at(-1);
		while (line.length && /^ +$/.test(line.at(-1).text)) used -= line.pop().text.length;
	};
	for (const unit of units(spans)) {
		if (unit.kind === 'newline') {
			trim();
			lines.push([]);
			used = 0;
			continue;
		}
		if (unit.kind === 'space') {
			if (used === 0) continue;
			if (used + unit.width > width) {
				trim();
				lines.push([]);
				used = 0;
				continue;
			}
			lines.at(-1).push(...unit.pieces);
			used += unit.width;
			continue;
		}
		for (const part of unit.width > width ? splitWord(unit, width) : [unit]) {
			if (used > 0 && used + part.width > width) {
				trim();
				lines.push([]);
				used = 0;
			}
			lines.at(-1).push(...part.pieces);
			used += part.width;
		}
	}
	trim();
	return lines;
}

function paint(pieces) {
	return pieces
		.map((p) => (p.href ? `${ESC}]8;;${p.href}${BEL}` : '') + R + p.style + p.text + R + (p.href ? `${ESC}]8;;${BEL}` : ''))
		.join('');
}

const lineWidth = (pieces) => pieces.reduce((sum, p) => sum + textWidth(p.text), 0);

function imageSize(bytes) {
	if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
		return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		let i = 2;
		while (i + 9 < bytes.length) {
			if (bytes[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = bytes[i + 1];
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
				return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
			}
			i += 2 + bytes.readUInt16BE(i + 2);
		}
	}
	if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
		const chunk = bytes.toString('ascii', 12, 16);
		if (chunk === 'VP8X') return { w: 1 + bytes.readUIntLE(24, 3), h: 1 + bytes.readUIntLE(27, 3) };
		if (chunk === 'VP8 ') return { w: bytes.readUInt16LE(26) & 0x3fff, h: bytes.readUInt16LE(28) & 0x3fff };
		if (chunk === 'VP8L') {
			const bits = bytes.readUInt32LE(21);
			return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
		}
	}
	return null;
}

function projectRoot(from) {
	let dir = from;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, 'package.json'))) return dir;
		dir = dirname(dir);
	}
	return from;
}

function resolveImage(src, file) {
	if (/^https?:/i.test(src)) return null;
	if (src.startsWith('/')) {
		const root = projectRoot(dirname(file));
		const found = ['static', 'public'].map((dir) => join(root, dir, src)).find(existsSync);
		return found ?? (existsSync(src) ? src : null);
	}
	const path = resolve(dirname(file), decodeURI(src));
	return existsSync(path) ? path : null;
}

function loadImage(path) {
	const stat = statSync(path, { throwIfNoEntry: false });
	if (!stat) return null;
	const cached = images.get(path);
	if (cached && cached.mtime === stat.mtimeMs) return cached;
	const bytes = readFileSync(path);
	const entry = { mtime: stat.mtimeMs, size: bytes.length, data: bytes.toString('base64'), dims: imageSize(bytes) };
	images.set(path, entry);
	return entry;
}

const plain = (tokens) =>
	inlineSpans(tokens)
		.map((s) => (s.text === '\n' ? ' ' : s.text))
		.join('')
		.replace(/ /g, ' ')
		.trim();

function headingImage(text, color, level, maxCols) {
	const spec = HEADINGS[level];
	const job = {
		text,
		color,
		rows: spec.rows,
		fontPx: cell.height * spec.scale,
		maxCols,
		cellW: cell.width,
		cellH: cell.height,
		tracking: spec.tracking
	};
	const key = JSON.stringify(job);
	const hit = headings.get(key);
	if (hit) return hit.data ? hit : null;
	if (raster.exitCode !== null || !raster.stdin.writable) return null;
	headings.set(key, { pending: true });
	raster.stdin.write(`${JSON.stringify({ ...job, key })}\n`);
	return null;
}

function frontmatter(text) {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const meta = {};
	if (lines[0]?.trim() !== '---') return { meta, body: lines.join('\n'), offset: 0 };
	const end = lines.indexOf('---', 1);
	if (end < 0) return { meta, body: lines.join('\n'), offset: 0 };
	for (const line of lines.slice(1, end)) {
		const i = line.indexOf(':');
		if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
	return { meta, body: lines.slice(end + 1).join('\n'), offset: end + 1 };
}

function layout(doc, file, cols, height) {
	const { meta, body, offset } = frontmatter(doc);
	accentHex = fg(meta.color) ? meta.color : '#7aa2f7';
	accent = fg(accentHex);
	const rows = [];
	const marks = [];
	const width = Math.max(20, cols - MARGIN * 2);
	const margin = ' '.repeat(MARGIN);

	const lead = (first, rest = first) => ({ first, rest, used: false });
	const take = (prefix) => {
		const value = prefix.used ? prefix.rest : prefix.first;
		prefix.used = true;
		return value;
	};
	const emit = (prefix, text) => rows.push({ kind: 'text', text: margin + take(prefix) + text });
	const spacer = (prefix) => rows.push({ kind: 'text', text: margin + prefix.rest.trimEnd() });

	const picture = (image, alt, col, available) => {
		const ratio = image.dims ? image.dims.h / image.dims.w : 9 / 16;
		const perCol = (cell.width * ratio) / cell.height;
		const cap = Math.max(3, Math.floor(height * 0.6));
		let box = Math.min(available, 72);
		let size = Math.max(1, Math.ceil(box * perCol));
		if (size > cap) {
			size = cap;
			box = Math.max(1, Math.floor(cap / perCol));
		}
		rows.push({ kind: 'image', image, cols: box, rows: size, col, alt, perCol });
		for (let i = 1; i < size; i++) rows.push({ kind: 'cont', text: '' });
	};

	const heading = (text, level, color, prefix, col, available) => {
		const spec = HEADINGS[level];
		const image = headingImage(text, color, level, available);
		if (image) {
			rows.push({ kind: 'image', image, cols: image.cols, rows: image.rows, col, heading: true });
			for (let i = 1; i < image.rows; i++) rows.push({ kind: 'cont', text: '' });
			prefix.used = true;
			return;
		}
		const lines = wrapSpans([{ text, style: fg(color) + BOLD }], available);
		const pad = Math.floor((spec.rows - 1) / 2);
		for (let i = 0; i < pad; i++) rows.push({ kind: 'text', text: '' });
		for (const line of lines) emit(prefix, paint(line));
		for (let i = pad + 1; i < spec.rows; i++) rows.push({ kind: 'text', text: '' });
	};

	const table = (token, prefix, available) => {
		const header = token.header.map((c) => inlineSpans(c.tokens, BOLD));
		const body = token.rows.map((row) => row.map((c) => inlineSpans(c.tokens)));
		const count = header.length;
		const natural = header.map((_, c) =>
			Math.max(3, ...[header, ...body].map((row) => Math.max(0, ...wrapSpans(row[c] ?? [], 1e6).map(lineWidth))))
		);
		const room = Math.max(count * 3, available - (count * 3 + 1));
		const widths = [...natural];
		while (widths.reduce((a, b) => a + b, 0) > room) {
			const widest = widths.indexOf(Math.max(...widths));
			if (widths[widest] <= 3) break;
			widths[widest]--;
		}
		const border = (l, m, r) => `${DIM}${l}${widths.map((w) => '─'.repeat(w + 2)).join(m)}${r}${R}`;
		const renderRow = (cells) => {
			const wrapped = widths.map((w, c) => wrapSpans(cells[c] ?? [], w));
			const tall = Math.max(...wrapped.map((l) => l.length));
			for (let i = 0; i < tall; i++) {
				const parts = wrapped.map((lines, c) => {
					const line = lines[i] ?? [];
					const gap = widths[c] - lineWidth(line);
					const align = token.align[c];
					const left = align === 'right' ? gap : align === 'center' ? Math.floor(gap / 2) : 0;
					return ' '.repeat(left) + paint(line) + ' '.repeat(gap - left);
				});
				emit(prefix, `${DIM}│${R} ${parts.join(` ${DIM}│${R} `)} ${DIM}│${R}`);
			}
		};
		emit(prefix, border('┌', '┬', '┐'));
		renderRow(header);
		emit(prefix, border('├', '┼', '┤'));
		body.forEach(renderRow);
		emit(prefix, border('└', '┴', '┘'));
	};

	const blocks = (tokens, prefix, available, depth, tight = false) => {
		let first = true;
		for (const token of tokens) {
			if (token.type === 'space' || token.type === 'def' || token.type === 'checkbox') continue;
			if (!first && !tight) spacer(prefix);
			first = false;
			block(token, prefix, available, depth);
		}
	};

	const block = (token, prefix, available, depth) => {
		const col = MARGIN + textWidth(bareText(prefix.used ? prefix.rest : prefix.first));
		if (token.type === 'heading') {
			heading(plain(token.tokens), token.depth, HEADINGS[token.depth].color, prefix, col, available);
		} else if (token.type === 'paragraph' || token.type === 'text') {
			const only = token.tokens?.filter((t) => !(t.type === 'text' && !t.text.trim()));
			const lone = only?.length === 1 ? (only[0].type === 'link' ? only[0].tokens?.[0] : only[0]) : null;
			if (lone?.type === 'image') {
				const path = resolveImage(lone.href, file);
				const image = path && loadImage(path);
				if (image) {
					picture(image, lone.text, col, available);
					prefix.used = true;
					return;
				}
				emit(prefix, `${DIM}[missing image: ${lone.href}]${R}`);
				return;
			}
			const spans = token.tokens ? inlineSpans(token.tokens) : [{ text: decode(token.text), style: '' }];
			for (const line of wrapSpans(spans, available)) emit(prefix, paint(line));
		} else if (token.type === 'code') {
			if (token.lang) emit(prefix, `${DIM}${token.lang}${R}`);
			const code = token.text.replace(/\t/g, '    ').split('\n');
			for (const line of code) {
				const chunks = line.length ? line.match(new RegExp(`.{1,${Math.max(8, available - 2)}}`, 'gu')) : [''];
				for (const chunk of chunks) emit(prefix, `${accent}▏${R} ${CODE_TEXT}${chunk}${R}`);
			}
		} else if (token.type === 'blockquote') {
			const bar = `${accent}│${R} `;
			blocks(token.tokens, lead(take(prefix) + bar, prefix.rest + bar), available - 2, depth);
		} else if (token.type === 'list') {
			const bullets = ['•', '◦', '▪'];
			token.items.forEach((item, i) => {
				if (i > 0 && token.loose) spacer(prefix);
				let marker = token.ordered ? `${Number(token.start || 1) + i}.` : bullets[depth % bullets.length];
				let style = token.ordered ? DIM : accent;
				if (item.task) {
					marker = item.checked ? '☑' : '☐';
					style = item.checked ? accent : DIM;
				}
				const indent = ' '.repeat(textWidth(marker) + 1);
				const inner = lead(take(prefix) + `${style}${marker}${R} `, prefix.rest + indent);
				const content = item.tokens.filter((t) => t.type !== 'checkbox');
				const styled = item.task && item.checked
					? content.map((t) => (t.type === 'text' ? { ...t, tokens: [{ type: 'del', tokens: t.tokens ?? [t] }] } : t))
					: content;
				blocks(styled, inner, available - indent.length, depth + 1, !token.loose);
			});
		} else if (token.type === 'table') {
			table(token, prefix, available);
		} else if (token.type === 'hr') {
			emit(prefix, `${DIM}${'─'.repeat(available)}${R}`);
		} else if (token.type === 'html') {
			if (/^\s*<!--/.test(token.raw)) {
				rows.push({ kind: 'skip' });
				return;
			}
			const spans = inlineSpans(marked.Lexer.lexInline(token.raw.trim()));
			for (const line of wrapSpans(spans, available)) emit(prefix, paint(line));
		} else if (token.tokens) {
			for (const line of wrapSpans(inlineSpans(token.tokens), available)) emit(prefix, paint(line));
		} else if (token.text) {
			for (const line of wrapSpans([{ text: decode(token.text), style: '' }], available)) emit(prefix, paint(line));
		}
	};

	if (meta.title) {
		rows.push({ kind: 'text', text: '' });
		heading(meta.title, 0, accentHex, lead(''), MARGIN, width);
		const sub = [meta.date, meta.tldr].filter(Boolean).join('  ·  ');
		if (sub) for (const line of wrapSpans([{ text: sub, style: DIM }], width)) rows.push({ kind: 'text', text: margin + paint(line) });
	}

	let line = offset;
	for (const token of marked.lexer(body, { gfm: true, breaks: true })) {
		const count = (token.raw.match(/\n/g) ?? []).length;
		if (token.type !== 'space' && token.type !== 'def') {
			const previous = rows.at(-1);
			if (previous && !(previous.kind === 'text' && previous.text === '')) rows.push({ kind: 'text', text: '' });
			const start = rows.length;
			block(token, lead(''), width, 0);
			while (rows.length > start && rows.at(-1).kind === 'skip') rows.pop();
			marks.push({ line, count: Math.max(1, count), row: start, rows: rows.length - start });
		}
		line += count;
	}

	return { rows: rows.filter((row) => row.kind !== 'skip'), marks };
}

const bareText = (s) => s.replace(/\u001b\]8;;[^\u0007]*\u0007/g, '').replace(/\u001b\[[0-9;]*m/g, '');

function focusRow(marks, cursor) {
	const line = cursor - 1;
	let mark = null;
	for (const candidate of marks) {
		if (candidate.line > line) break;
		mark = candidate;
	}
	if (!mark) return 0;
	const within = Math.min(1, (line - mark.line) / Math.max(1, mark.count));
	return mark.row + Math.floor(within * mark.rows);
}

function draw(state) {
	const cols = out.columns ?? 80;
	const height = out.rows ?? 24;
	const { rows, marks } = layout(state.text, state.file, cols, height);
	let top = Math.max(0, Math.min(focusRow(marks, state.cursor) - Math.floor(height / 3), rows.length - height + 1));
	while (top > 0 && rows[top]?.kind === 'cont') top--;

	let frame = `${ESC}[?2026h`;
	for (let r = 1; r <= height; r++) frame += `${ESC}[${r};1H${ESC}#5${ESC}[2K`;

	for (let r = 0; r < height; r++) {
		const row = rows[top + r];
		if (!row) break;
		if (row.kind === 'cont') continue;
		if (row.kind === 'image') {
			const fit = Math.min(row.rows, height - r - 1);
			if (row.heading && fit < row.rows) break;
			if (!row.heading && fit < 6) {
				frame += `${ESC}[${r + 1};${row.col + 1}H${DIM}↓ ${row.alt || 'image'}${R}`;
				break;
			}
			const cols = fit === row.rows ? row.cols : Math.max(1, Math.floor(fit / row.perCol));
			frame += `${ESC}[${r + 1};${row.col + 1}H${ESC}]1337;File=inline=1;size=${row.image.size};width=${cols};height=${fit};preserveAspectRatio=1:${row.image.data}${BEL}`;
			if (fit < row.rows) break;
			continue;
		}
		frame += `${ESC}[${r + 1};1H${row.text}${R}`;
	}

	out.write(`${frame}${ESC}[?2026l`);
}

function refresh() {
	try {
		last = JSON.parse(readFileSync(statePath, 'utf8'));
	} catch {
		return;
	}
	draw(last);
}

function measureCells() {
	return new Promise((done) => {
		const onData = (chunk) => {
			const match = /\u001b\[6;(\d+);(\d+)t/.exec(chunk.toString());
			if (!match) return;
			clearTimeout(timer);
			process.stdin.off('data', onData);
			done({ height: +match[1], width: +match[2] });
		};
		const timer = setTimeout(() => {
			process.stdin.off('data', onData);
			done(null);
		}, 400);
		process.stdin.on('data', onData);
		out.write(`${ESC}[16t`);
	});
}

function quit() {
	raster.kill();
	out.write(`${ESC}[?25h${ESC}[?1049l`);
	process.exit(0);
}

out.write(`${ESC}[?1049h${ESC}[?25l`);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
cell = (await measureCells()) ?? cell;
process.stdin.on('data', (chunk) => {
	if (chunk.includes(3) || chunk.includes(113)) quit();
});
process.on('SIGTERM', quit);
process.on('SIGHUP', quit);
out.on('resize', () => last && draw(last));

let pending;
watch(dirname(statePath), (_, name) => {
	if (name !== basename(statePath)) return;
	clearTimeout(pending);
	pending = setTimeout(refresh, 10);
});
refresh();
