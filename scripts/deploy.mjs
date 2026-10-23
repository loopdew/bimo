#!/usr/bin/env node
/**
 * Copy the built plugin into the Obsidian plugin folder and verify the copy.
 *
 * The project lives OUTSIDE the vault (D:\bimo-src). Where the plugin gets
 * deployed is resolved in this order:
 *
 *   1. BIMO_PLUGIN_DIR environment variable
 *   2. .bimo-target file in the project root (one absolute path)
 *   3. ../../.obsidian/plugins/bimo  (only correct when the project sits in a vault)
 *
 * Prints md5 of both sides so a stale copy cannot pass silently.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const vaultRoot = resolve(projectRoot, '..', '..');

const targetFile = resolve(projectRoot, '.bimo-target');
const configuredTarget = existsSync(targetFile) ? readFileSync(targetFile, 'utf8').trim() : '';
const target =
	process.env.BIMO_PLUGIN_DIR ||
	(configuredTarget || resolve(vaultRoot, '.obsidian', 'plugins', 'bimo'));

const FILES = [
	{ from: resolve(projectRoot, 'dist', 'main.js'), name: 'main.js', required: true },
	{ from: resolve(projectRoot, 'dist', 'styles.css'), name: 'styles.css', required: false },
	{ from: resolve(projectRoot, 'manifest.json'), name: 'manifest.json', required: false },
];

const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex');

mkdirSync(target, { recursive: true });

let failed = false;
for (const file of FILES) {
	if (!existsSync(file.from)) {
		if (file.required) {
			console.error(`missing build artifact: ${file.from}\nrun "npm run build" first`);
			process.exit(1);
		}
		console.warn(`skip (not built): ${file.name}`);
		continue;
	}
	const dest = resolve(target, file.name);
	copyFileSync(file.from, dest);
	const a = md5(file.from);
	const b = md5(dest);
	const ok = a === b;
	if (!ok) failed = true;
	const size = statSync(dest).size;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${file.name.padEnd(14)} ${String(size).padStart(9)} B  ${b.slice(0, 8)}`);
}

const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'manifest.json'), 'utf8'));
console.log(`\nplugin: ${manifest.name} (${manifest.id}) v${manifest.version}`);
console.log(`target: ${target}`);

if (failed) {
	console.error('\nchecksum mismatch — copy did not land correctly');
	process.exit(1);
}
console.log('\nreload Obsidian (Ctrl+P → Reload app without saving) to pick it up');
