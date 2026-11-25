// Runs the board browser checks (scripts/check-board-*.mjs) against a throwaway Storybook.
//
//   pnpm check:browser                 # every check
//   pnpm check:browser draw comments   # only checks whose file name contains one of the words
//
// It starts `storybook dev` with scripts/check-storybook (the addon loaded from src/, the example
// stories plus scripts/fixtures) on $PORT (default 6190), with canvases in .sb-checks/canvases, a
// git-ignored folder it empties before and deletes after the run. It never reads or writes
// .storybook/canvases. Needs the installed Google Chrome 157+ ($CHROME to override its path).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 6190);
const SB = `http://127.0.0.1:${PORT}`;
const WORK_DIR = join(ROOT, '.sb-checks');
const CANVAS_DIR = join(WORK_DIR, 'canvases');
const OUT = mkdtempSync(join(tmpdir(), 'colab-checks-'));
const filters = process.argv.slice(2);

const checks = readdirSync(join(ROOT, 'scripts'))
  .filter((name) => /^check-board-.*\.mjs$/.test(name))
  .filter((name) => filters.length === 0 || filters.some((word) => name.includes(word)))
  .sort();
if (checks.length === 0) {
  console.error(`No check matches ${filters.join(', ')}`);
  process.exit(1);
}

await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', () => reject(new Error(`Port ${PORT} is in use; set PORT to a free one`)));
  probe.listen(PORT, '127.0.0.1', () => probe.close(resolve));
});

rmSync(WORK_DIR, { recursive: true, force: true });
mkdirSync(CANVAS_DIR, { recursive: true });

console.log(`Starting Storybook on ${SB} (canvases in .sb-checks/canvases)…`);
const server = spawn(
  join(ROOT, 'node_modules/.bin/storybook'),
  ['dev', '-p', String(PORT), '--host', '127.0.0.1', '-c', 'scripts/check-storybook', '--ci', '--quiet'],
  {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, COLAB_CHECK_CANVAS_DIR: CANVAS_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverLog = '';
server.stdout.on('data', (chunk) => (serverLog += chunk));
server.stderr.on('data', (chunk) => (serverLog += chunk));

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  rmSync(WORK_DIR, { recursive: true, force: true });
}
process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

const results = [];
try {
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`Storybook exited early:\n${serverLog}`);
    try {
      if ((await fetch(`${SB}/index.json`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`Storybook did not start within 3 minutes:\n${serverLog}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  for (const name of checks) {
    console.log(`\n=== ${name}`);
    const started = Date.now();
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join('scripts', name)], {
        cwd: ROOT,
        env: { ...process.env, SB, CANVAS_DIR, OUT },
        stdio: 'inherit',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode ?? 1);
      });
    });
    results.push({ name, ok: code === 0, seconds: Math.round((Date.now() - started) / 1000) });
  }
} finally {
  stopServer();
}

console.log('\n=== Summary');
for (const { name, ok, seconds } of results) console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name} (${seconds}s)`);
console.log(`Screenshots and other output: ${OUT}`);
const failed = results.filter((result) => !result.ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nall ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
