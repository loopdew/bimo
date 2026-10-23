#!/usr/bin/env node
/**
 * i18n coverage check for 笔墨.
 *
 * English mode falls back to the key itself, so a missing Chinese entry stays
 * invisible until the UI language is switched — which is exactly how we run.
 *
 * Reports two things:
 *   1. missing  — t('…') literals with no dictionary entry  (fails the build)
 *   2. orphans  — dictionary entries nothing references        (warning only)
 *
 * Orphans are a warning because some keys are resolved dynamically
 * (e.g. `t(someVariable)`), so an "orphan" can still be live.
 */
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');

function walk(dir, out) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			walk(full, out);
		} else if (/\.(ts|tsx)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

const dictSource = fs.readFileSync(path.join(srcRoot, 'i18n', 'zh-cn.ts'), 'utf8').replace(/\r\n/g, '\n');
const known = new Set();
// Matches both `'key': 'value',` and multi-line `'key':\n\t'value',`
// Keys may be single- or double-quoted: the dictionary uses double quotes when
// the text itself contains an apostrophe.
const dictRe = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:/gm;
let match;
// Unescape the same way the code side is unescaped, otherwise keys containing
// an apostrophe (`Ink\'s`) report as missing when they are present.
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');
while ((match = dictRe.exec(dictSource)) !== null) {
	known.add(unescape(match[1] !== undefined ? match[1] : match[2]));
}

// Any of the three quote styles, since the codebase uses all of them.
const callRe = /\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const missing = new Map();
const used = new Set();

for (const file of walk(srcRoot, [])) {
	if (file.includes(path.join('src', 'i18n'))) continue;
	const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
	let m;
	while ((m = callRe.exec(text)) !== null) {
		const key = unescape(m[2]);
		used.add(key);
		if (!known.has(key)) {
			const rel = path.relative(root, file);
			if (!missing.has(key)) missing.set(key, new Set());
			missing.get(key).add(rel);
		}
	}
}

const orphans = [...known].filter((k) => !used.has(k));

// A key split across concatenated literals never matches the call regex, so
// look for a leading fragment in the raw sources before calling it dead.
const sources = walk(srcRoot, [])
	.filter((f) => !f.includes(path.join('src', 'i18n')))
	.map((f) => fs.readFileSync(f, 'utf8'))
	.join('\n');
const trulyDead = [];
const maybeConcatenated = [];
for (const key of orphans) {
	const probe = key.slice(0, Math.min(30, key.length));
	if (probe.length >= 12 && sources.includes(probe)) maybeConcatenated.push(key);
	else trulyDead.push(key);
}

// A t() argument built from concatenated literals only yields its first
// fragment here. If that fragment prefixes a real key, it is not a miss.
const knownList = [...known];
const realMissing = new Map();
const fragments = [];
for (const [key, files] of missing) {
	const isFragment = knownList.some((k) => k !== key && k.startsWith(key));
	if (isFragment) fragments.push(key);
	else realMissing.set(key, files);
}

console.log(`dict keys: ${known.size}`);
console.log(`used keys: ${used.size}`);
console.log(`missing translations: ${realMissing.size}${fragments.length ? ` (${fragments.length} concatenated fragment(s) ignored)` : ''}`);
for (const [key, files] of realMissing) {
	console.log(`  ${JSON.stringify(key)}  ←  ${[...files].slice(0, 3).join(', ')}`);
}

console.log(`unused entries: ${orphans.length} (dead ${trulyDead.length} / maybe concatenated ${maybeConcatenated.length})`);
for (const key of trulyDead) console.log(`  · ${JSON.stringify(key)}`);
if (process.argv.includes('--verbose')) {
	for (const key of maybeConcatenated) console.log(`  ~ ${JSON.stringify(key)}`);
}

process.exit(realMissing.size === 0 ? 0 : 1);
