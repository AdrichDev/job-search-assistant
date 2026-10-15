import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Executable architecture rules.
 *
 * These caught a real bug: a `'use client'` component imported the root barrel
 * and dragged `node:fs` into the browser bundle. A comment saying "the domain
 * is pure" would not have caught it - this does.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        return filesUnder(full);
      }
      return entry.name.endsWith('.ts') ? [full] : [];
    }),
  );
  return found.flat();
}

function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe('domain purity', () => {
  it('never imports a node builtin', async () => {
    const files = await filesUnder(join(SRC, 'domain'));
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importsOf(source)) {
        if (specifier.startsWith('node:')) {
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never imports an adapter, the app layer or config', async () => {
    const files = await filesUnder(join(SRC, 'domain'));
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importsOf(source)) {
        if (/(^|\/)(adapters|app|config|cli)\//.test(specifier)) {
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('depends on no third-party runtime package', async () => {
    const files = await filesUnder(join(SRC, 'domain'));
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importsOf(source)) {
        if (!specifier.startsWith('.')) {
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('application layer', () => {
  /**
   * The arrow is `adapters -> app -> ports -> domain`. `config` sits outside it:
   * it is what a composition root reads in order to WIRE the app, not something
   * the app reaches for on its own.
   *
   * This rule is here because Filter B nearly broke it. `buildJobQueue` briefly
   * defaulted its junior-filter vocabulary from `config/junior-filter-config.ts`
   * while its sibling `scoringConfig` was injected - convenient, inconsistent,
   * and the first step toward a use case that cannot be tested without the
   * production configuration.
   */
  it('never imports config, the CLI, or an adapter', async () => {
    const files = await filesUnder(join(SRC, 'app'));
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of importsOf(source)) {
        if (/(^|\/)(adapters|config|cli)\//.test(specifier)) {
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('client-safe entry point', () => {
  it('pulls in nothing that touches the filesystem', async () => {
    // Walks the real import graph reachable from `domain-index.ts`, which is
    // exactly what a browser bundler would do.
    const visited = new Set<string>();
    const offenders: string[] = [];

    async function walk(file: string): Promise<void> {
      if (visited.has(file)) {
        return;
      }
      visited.add(file);

      const source = await readFile(file, 'utf8');
      for (const specifier of importsOf(source)) {
        if (specifier.startsWith('node:')) {
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
          continue;
        }
        if (!specifier.startsWith('.')) {
          offenders.push(`${relative(SRC, file)} -> ${specifier}`);
          continue;
        }
        const resolved = join(file, '..', specifier.replace(/\.js$/, '.ts'));
        await walk(resolved);
      }
    }

    await walk(join(SRC, 'domain-index.ts'));

    expect(offenders).toEqual([]);
    expect(visited.size).toBeGreaterThan(5);
  });
});
