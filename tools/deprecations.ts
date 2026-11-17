/**
 * The no-deprecated-APIs rule (ADR 0031), checked automatically (ADR 0033): what counts as a
 * deprecation warning in any tool's output, and a runner that fails a command that prints
 * one. `npm test` checks every test file through tests/setup/noDeprecations.ts, `npm run size`
 * runs the production build through this, and CI checks `npm ci` for deprecated packages.
 *
 * Usage: `tsx tools/deprecations.ts <command> [args...]`: runs the command, shows its output as
 * usual, and exits with 1 if it failed or printed a deprecation warning.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Lines that are deprecation warnings: three.js, wasm-bindgen, Node (DeprecationWarning, DEP0xxx), npm and Vite all say "deprecat...". */
export function deprecationLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => /deprecat|\bDEP\d{4}\b/i.test(line));
}

/** Runs a command through the shell, passing its output through; resolves to its exit code and everything it printed. */
function run(command: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command.join(' '), { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv.slice(2);
  if (command.length === 0) {
    console.error('Usage: tsx tools/deprecations.ts <command> [args...]');
    process.exit(2);
  }
  const { code, output } = await run(command);
  const found = deprecationLines(output);
  if (found.length > 0) {
    console.error(`\n${found.length} deprecation warning(s) from "${command.join(' ')}" (ADR 0031: no deprecated APIs):\n${found.join('\n')}`);
    process.exit(1);
  }
  process.exit(code);
}
