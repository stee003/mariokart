// Parses every source file the browser loads.
//
// Why this exists: the whole suite passed while src/main.js contained a
// duplicated tail fragment - a syntax error that stopped the game booting in
// any browser, because no test ever parsed the entry point. Node's `--check`
// is the cheapest possible guard and it runs in ~2 seconds for the whole tree.
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'lib', '.git', 'data']);

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full, out);
    else if (/\.(?:js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function check(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--check', file], (err, _stdout, stderr) => {
      resolve({ file, ok: !err, error: err ? (stderr || String(err)).split('\n').slice(0, 3).join(' ') : null });
    });
  });
}

let passed = 0, failed = 0;
const check2 = (name, cond, extra = '') => {
  cond ? (passed++, console.log(`  PASS ${name}`)) : (failed++, console.log(`  FAIL ${name} ${extra}`));
};

const files = [...(await walk(path.join(ROOT, 'src'))), path.join(ROOT, 'server.mjs')];
// index.html's inline module (if any) and the tests themselves are not shipped
// to the browser, but a broken test file is worth catching too.
const testFiles = await walk(path.join(ROOT, 'test'));

console.log('--- shipped modules parse ---');
const results = await Promise.all(files.map(check));
const broken = results.filter((r) => !r.ok);
check2(`${files.length} src/server files parse as ES modules`, broken.length === 0,
  broken.map((b) => `${b.file}: ${b.error}`).join(' | '));
check2('the game entry point is among them',
  files.some((f) => f.endsWith(path.join('src', 'main.js'))));

console.log('--- test files parse ---');
const testResults = await Promise.all(testFiles.map(check));
const brokenTests = testResults.filter((r) => !r.ok);
check2(`${testFiles.length} test files parse`, brokenTests.length === 0,
  brokenTests.map((b) => `${b.file}: ${b.error}`).join(' | '));

console.log('--- entry point sanity ---');
const { readFile } = await import('node:fs/promises');
const mainSrc = await readFile(path.join(ROOT, 'src', 'main.js'), 'utf8');
check2('main.js has exactly one Game bootstrap block',
  (mainSrc.match(/new Game\(\)/g) || []).length === 1,
  `found ${(mainSrc.match(/new Game\(\)/g) || []).length}`);
check2('main.js class braces are balanced',
  (mainSrc.match(/\{/g) || []).length === (mainSrc.match(/\}/g) || []).length,
  `{=${(mainSrc.match(/\{/g) || []).length} }=${(mainSrc.match(/\}/g) || []).length}`);
const indexHtml = await readFile(path.join(ROOT, 'index.html'), 'utf8');
check2('index.html loads main.js as a module',
  /<script[^>]+type="module"[^>]+src="src\/main\.js"/.test(indexHtml));
check2('every screen id referenced by main.js exists in index.html', (() => {
  const ids = new Set([...mainSrc.matchAll(/showScreen\('([a-z-]+)'\)/g)].map((m) => m[1]));
  for (const id of ids) if (!indexHtml.includes(`id="${id}"`)) return false;
  return ids.size > 0;
})());

console.log('--- index.html wiring ---');
const srcFiles = await Promise.all(
  (await walk(path.join(ROOT, 'src'))).map(async (f) => ({ f, text: await readFile(f, 'utf8') })),
);
const allSrc = srcFiles.map((s2) => s2.text).join('\n') + mainSrc;

check2('every button in index.html is wired to code', (() => {
  const ids = [...indexHtml.matchAll(/<button[^>]+id="([^"]+)"/g)].map((m) => m[1]);
  const missing = ids.filter((id) => !allSrc.includes(`'${id}'`) && !allSrc.includes(`"${id}"`) && !allSrc.includes(`#${id}`));
  if (missing.length) console.log('    unwired:', missing.join(', '));
  return ids.length > 5 && missing.length === 0;
})());

check2('every data-i18n key in index.html resolves', (async () => true)() && await (async () => {
  const { STRINGS } = await import('../src/i18n.js');
  const keys = [...indexHtml.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const missing = keys.filter((k) => !STRINGS[k] || !STRINGS[k].en || !STRINGS[k].it);
  if (missing.length) console.log('    missing strings:', missing.join(', '));
  return keys.length > 10 && missing.length === 0;
})());

check2('every localized key written in src/*.js exists in STRINGS', await (async () => {
  const { STRINGS } = await import('../src/i18n.js');
  const referenced = new Set();
  const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const { text } of srcFiles) {
    const code = stripComments(text);
    for (const m of code.matchAll(/\bi18n\.t\('([a-zA-Z0-9_.]+)'/g)) referenced.add(m[1]);
    for (const m of code.matchAll(/data-i18n="([^"]+)"/g)) referenced.add(m[1]);
  }
  // Keys composed at runtime from a constant prefix ('trophy.' + id,
  // `online.error.${code}`): a prefix is fine as long as at least one of the
  // strings it can produce exists.
  const dynamicPrefixes = ['online.error.', 'trophy.', 'ordinal.', 'difficulty.', 'ach.', 'records.stat.'];
  const dynamicOk = (k) => dynamicPrefixes.some((p2) => k.startsWith(p2) && Object.keys(STRINGS).some((s2) => s2.startsWith(p2)));
  const missing = [...referenced].filter((k) => !STRINGS[k] && !dynamicOk(k));
  if (missing.length) console.log('    missing strings:', missing.join(', '));
  return referenced.size > 50 && missing.length === 0;
})());

console.log('--- style coverage ---');
const css = await readFile(path.join(ROOT, 'css', 'style.css'), 'utf8');
check2('every CSS class the UI code renders exists in style.css', (() => {
  const used = new Set();
  for (const { text } of srcFiles) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/className = ['"]([^'"]+)['"]/g)) for (const c of m[1].split(' ')) used.add(c);
    for (const m of code.matchAll(/classList\.(?:add|toggle)\('([^']+)'/g)) used.add(m[1]);
    for (const m of code.matchAll(/el\('[a-z]+', '([^']+)'/g)) for (const c of m[1].split(' ')) used.add(c);
  }
  const missing = [...used].filter((c) => c && !c.includes('$') && !css.includes(`.${c}`));
  if (missing.length) console.log('    unstyled:', missing.join(', '));
  return used.size > 40 && missing.length === 0;
})());
check2('every screen in index.html is a .screen element', (() => {
  const ids = [...indexHtml.matchAll(/<div id="(screen-[a-z]+)" class="([^"]*)"/g)];
  return ids.length >= 10 && ids.every(([, , cls]) => cls.includes('screen'));
})());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
