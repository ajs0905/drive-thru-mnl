/**
 * Checks the production build in dist/ against the size budgets (tools/bundleBudget.ts).
 * Run after `vite build`: `npm run size`. Exits with 1 if a chunk is over its budget.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkBudgets, gzipSize } from './bundleBudget';

const dir = 'dist/assets';
let files: string[];
try {
  files = readdirSync(dir).filter((f) => /\.(js|css)$/.test(f));
} catch {
  console.error(`No ${dir}: run vite build first.`);
  process.exit(1);
}
const rows = checkBudgets(files.map((file) => ({ file, gzip: gzipSize(readFileSync(join(dir, file))) })));
rows.sort((a, b) => b.kb - a.kb);
for (const r of rows) console.log(`${r.over ? 'OVER' : 'ok  '}  ${r.file.padEnd(32)} ${r.kb.toFixed(1).padStart(7)} kB gzipped  (budget ${r.budget} kB)`);
const over = rows.filter((r) => r.over);
if (over.length) {
  console.error(`\n${over.length} chunk(s) over budget. Find what grew, or raise the budget in tools/bundleBudget.ts with a reason.`);
  process.exit(1);
}
console.log('\nBundle sizes within budget.');
