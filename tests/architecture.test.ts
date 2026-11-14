/**
 * Module boundaries from docs/ARCHITECTURE.md, section 3, checked on every test run.
 * Reads each source file's import statements and fails on imports that cross a boundary.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Import specifiers in a file, with relative ones resolved to repo paths (e.g. "src/map/types"). */
function importsOf(file: string): string[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const specs = [...text.matchAll(/^\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  return specs.map((s) => (s.startsWith('.') ? relative(ROOT, resolve(ROOT, file, '..', s)).replaceAll('\\', '/') : s));
}

const RENDERING = /^(three|three\/.*|@react-three\/.*|react|react-dom|react\/.*)$/;
const NODE = /^node:|^(fs|path|url|child_process|os)$/;

function violations(files: string[], rule: (spec: string) => boolean) {
  return files.flatMap((f) => importsOf(f).filter(rule).map((spec) => `${f} imports ${spec}`));
}

describe('module boundaries', () => {
  const src = sourceFiles('src');
  const pipeline = sourceFiles('pipeline');
  const pure = src.filter((f) => /^src\/(geo|geometry|map)\//.test(f.replaceAll('\\', '/')));

  it('finds the source files it checks', () => {
    expect(pure.length).toBeGreaterThan(5);
    expect(pipeline.length).toBeGreaterThan(5);
  });

  it('keeps geo, geometry and map free of three.js and React', () => {
    expect(violations(pure, (s) => RENDERING.test(s))).toEqual([]);
  });

  it('keeps geo, geometry and map from depending on the scene', () => {
    expect(violations(pure, (s) => s.startsWith('src/scene') || s.startsWith('src/App'))).toEqual([]);
  });

  it('never lets runtime code import the pipeline or Node built-ins', () => {
    expect(violations(src, (s) => s.startsWith('pipeline') || NODE.test(s))).toEqual([]);
  });

  it('keeps the pipeline away from rendering code', () => {
    expect(violations(pipeline, (s) => RENDERING.test(s) || s.startsWith('src/scene') || s.startsWith('src/App'))).toEqual([]);
  });
});
