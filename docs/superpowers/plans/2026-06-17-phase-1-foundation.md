# tsgraph Phase 1 — Foundation: Scaffold, Storage & Prototypes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the two day-1 prototype risks, scaffold the project with correct toolchain config, and ship a tested SQLite storage layer — all before any production graph code is written.

**Architecture:** Three sequential deliverables: (1) project scaffold with Bun + TypeScript + Biome wired up and `bun test` passing; (2) a typed SQLite abstraction layer with bun:sqlite as the sole backend, full PRAGMA setup, auto-schema-init, and nuke-rebuild on version mismatch; (3) two prototype scripts that conclusively answer "does X survive `bun build --compile`?" and a validation runner that prints a clear PASS/FAIL table.

**Tech Stack:** Bun 1.x, TypeScript 5.x, bun:sqlite, web-tree-sitter ^0.25, @mapequation/infomap ^1, @biomejs/biome ^1.9

---

## File structure

```
package.json
tsconfig.json
biome.json
src/
└── cli.ts                        # skeleton entry point
src/storage/
├── interface.ts                  # SqliteDb / SqliteStatement types
├── schema.ts                     # SCHEMA_VERSION + SCHEMA_STATEMENTS[]
├── bun-sqlite.ts                 # bun:sqlite implementation of SqliteDb
└── db.ts                         # openDb() factory: PRAGMAs + auto-init + nuke-rebuild
prototypes/
├── infomap-bun.ts                # Prototype A: infomap in compiled binary
└── tree-sitter-bun.ts            # Prototype B: web-tree-sitter WASM in compiled binary
scripts/
└── validate-prototypes.ts        # Runs both prototypes in dev + compiled mode, prints table
tests/storage/
├── schema.test.ts                # schema constants shape
└── db.test.ts                    # openDb: PRAGMAs, schema init, version mismatch nuke-rebuild
```

---

## Task 1 — Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `src/cli.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tsgraph",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "tsgraph": "./dist/tsgraph"
  },
  "scripts": {
    "dev": "bun run src/cli.ts",
    "build": "bun build --compile src/cli.ts --outfile dist/tsgraph",
    "build:node": "bun build src/cli.ts --outdir dist/node --target node",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "bunx @biomejs/biome check .",
    "proto:infomap": "bun run prototypes/infomap-bun.ts",
    "proto:tree-sitter": "bun run prototypes/tree-sitter-bun.ts",
    "proto:all": "bun run scripts/validate-prototypes.ts"
  },
  "dependencies": {
    "@mapequation/infomap": "^1.0.0",
    "web-tree-sitter": "^0.25.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "prototypes/**/*", "scripts/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["dist/", "node_modules/", "*.wasm"]
  }
}
```

- [ ] **Step 4: Create `src/cli.ts` skeleton**

```typescript
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: 'boolean', short: 'v' },
    help:    { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
});

if (values.version) {
  console.log('tsgraph 0.1.0');
  process.exit(0);
}

if (values.help || positionals.length === 0) {
  console.log(`
tsgraph — TypeScript Code Graph CLI

Usage:
  tsgraph build <dir>     Build the knowledge graph for a TypeScript project
  tsgraph query <seed>    Query the graph around a symbol
  tsgraph explain-edges   Show how framework edges are detected

Options:
  -v, --version  Show version
  -h, --help     Show this help
`);
  process.exit(0);
}

const [command] = positionals;
switch (command) {
  case 'build':
  case 'query':
  case 'explain-edges':
    console.error(`'${command}' not yet implemented (Phase 2/3)`);
    process.exit(1);
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
```

- [ ] **Step 5: Install dependencies**

```bash
bun install
```

Expected: lockfile written, `node_modules/@mapequation`, `node_modules/web-tree-sitter`, `node_modules/@biomejs` present.

- [ ] **Step 6: Verify CLI skeleton works**

```bash
bun run dev -- --version
```

Expected output: `tsgraph 0.1.0`

```bash
bun run dev -- --help
```

Expected: prints usage block.

- [ ] **Step 7: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 8: Verify lint passes**

```bash
bun run lint
```

Expected: no errors (or fix any Biome auto-fixes before committing).

- [ ] **Step 9: Commit**

```bash
git init
git add package.json tsconfig.json biome.json src/cli.ts .gitignore
git commit -m "feat: project scaffold — Bun + TypeScript + Biome"
```

---

## Task 2 — SQLite Interface & Schema Constants

**Files:**
- Create: `src/storage/interface.ts`
- Create: `src/storage/schema.ts`
- Create: `tests/storage/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/schema.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { SCHEMA_VERSION, SCHEMA_STATEMENTS } from '../../src/storage/schema.ts';

describe('schema constants', () => {
  test('SCHEMA_VERSION is 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  test('SCHEMA_STATEMENTS contains all required tables', () => {
    const sql = SCHEMA_STATEMENTS.join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS files');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS nodes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS edges');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tags');
  });

  test('SCHEMA_STATEMENTS contains required indexes', () => {
    const sql = SCHEMA_STATEMENTS.join('\n');
    expect(sql).toContain('idx_edges_src');
    expect(sql).toContain('idx_edges_dst');
    expect(sql).toContain('idx_nodes_file');
  });

  test('all PKs use AUTOINCREMENT to prevent ID reuse', () => {
    const withPk = SCHEMA_STATEMENTS.filter(s => s.includes('INTEGER PRIMARY KEY'));
    for (const stmt of withPk) {
      expect(stmt).toContain('AUTOINCREMENT');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/storage/schema.test.ts
```

Expected: FAIL — `Cannot find module '../../src/storage/schema.ts'`

- [ ] **Step 3: Create `src/storage/interface.ts`**

```typescript
export interface RowResult {
  changes: number;
  lastInsertRowid: bigint;
}

export interface SqliteStatement<T = unknown> {
  run(...params: unknown[]): RowResult;
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface SqliteDb {
  prepare<T = unknown>(sql: string): SqliteStatement<T>;
  run(sql: string, ...params: unknown[]): RowResult;
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
}
```

- [ ] **Step 4: Create `src/storage/schema.ts`**

```typescript
export const SCHEMA_VERSION = 1;

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    path         TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    shape_hash   TEXT NOT NULL,
    analyzed_at  INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS nodes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol_id  TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    file_id    INTEGER REFERENCES files(id),
    line_start INTEGER,
    line_end   INTEGER,
    signature  TEXT,
    pagerank   REAL,
    community  INTEGER,
    is_entry   INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS edges (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    src  INTEGER NOT NULL REFERENCES nodes(id),
    dst  INTEGER NOT NULL REFERENCES nodes(id),
    kind TEXT NOT NULL,
    key  TEXT,
    UNIQUE(src, dst, kind)
  )`,

  `CREATE TABLE IF NOT EXISTS tags (
    node_id INTEGER NOT NULL REFERENCES nodes(id),
    tag     TEXT NOT NULL,
    PRIMARY KEY (node_id, tag)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_edges_src  ON edges(src)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_dst  ON edges(dst)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_id)`,
];
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/storage/schema.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/storage/interface.ts src/storage/schema.ts tests/storage/schema.test.ts
git commit -m "feat: SQLite interface types and schema constants"
```

---

## Task 3 — bun:sqlite Backend

**Files:**
- Create: `src/storage/bun-sqlite.ts`
- Create: `tests/storage/bun-sqlite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage/bun-sqlite.test.ts`:

```typescript
import { describe, test, expect, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'node:fs';
import { createBunSqliteDb } from '../../src/storage/bun-sqlite.ts';

const TEST_DB = '/tmp/tsgraph-test-bun-sqlite.db';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB + suffix); } catch { /* ok */ }
  }
}

afterEach(cleanup);

describe('createBunSqliteDb', () => {
  test('creates a db file and runs a simple query', () => {
    const db = createBunSqliteDb(TEST_DB);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    const result = db.run('INSERT INTO t (v) VALUES (?)', 'hello');
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(1n);
    db.close();
    expect(existsSync(TEST_DB)).toBe(true);
  });

  test('get() returns undefined for no match', () => {
    const db = createBunSqliteDb(TEST_DB);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    const row = db.get<{ v: string }>('SELECT v FROM t WHERE id = ?', 999);
    expect(row).toBeUndefined();
    db.close();
  });

  test('get() returns typed row', () => {
    const db = createBunSqliteDb(TEST_DB);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    db.run('INSERT INTO t (v) VALUES (?)', 'world');
    const row = db.get<{ v: string }>('SELECT v FROM t WHERE id = ?', 1);
    expect(row?.v).toBe('world');
    db.close();
  });

  test('all() returns all rows', () => {
    const db = createBunSqliteDb(TEST_DB);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    db.run('INSERT INTO t (v) VALUES (?)', 'a');
    db.run('INSERT INTO t (v) VALUES (?)', 'b');
    db.run('INSERT INTO t (v) VALUES (?)', 'c');
    const rows = db.all<{ v: string }>('SELECT v FROM t ORDER BY id');
    expect(rows.map(r => r.v)).toEqual(['a', 'b', 'c']);
    db.close();
  });

  test('prepare() returns a reusable statement', () => {
    const db = createBunSqliteDb(TEST_DB);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    const stmt = db.prepare('INSERT INTO t (v) VALUES (?)');
    stmt.run('x');
    stmt.run('y');
    const rows = db.all<{ v: string }>('SELECT v FROM t ORDER BY id');
    expect(rows.map(r => r.v)).toEqual(['x', 'y']);
    db.close();
  });

  test('lastInsertRowid is returned as bigint', () => {
    const db = createBunSqliteDb(TEST_DB);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    const r1 = db.run('INSERT INTO t (v) VALUES (?)', 'first');
    const r2 = db.run('INSERT INTO t (v) VALUES (?)', 'second');
    expect(typeof r1.lastInsertRowid).toBe('bigint');
    expect(r1.lastInsertRowid).toBe(1n);
    expect(r2.lastInsertRowid).toBe(2n);
    db.close();
  });

  test('transaction() rolls back on error', () => {
    const db = createBunSqliteDb(TEST_DB);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)');
    try {
      db.transaction(() => {
        db.run('INSERT INTO t (v) VALUES (?)', 'valid');
        db.run('INSERT INTO t (v) VALUES (?)', null as unknown as string); // violates NOT NULL
      });
    } catch { /* expected */ }
    const rows = db.all('SELECT * FROM t');
    expect(rows).toHaveLength(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/storage/bun-sqlite.test.ts
```

Expected: FAIL — `Cannot find module '../../src/storage/bun-sqlite.ts'`

- [ ] **Step 3: Create `src/storage/bun-sqlite.ts`**

```typescript
import { Database } from 'bun:sqlite';
import type { SqliteDb, SqliteStatement, RowResult } from './interface.ts';

class BunStatement<T = unknown> implements SqliteStatement<T> {
  constructor(private readonly stmt: ReturnType<Database['prepare']>) {}

  run(...params: unknown[]): RowResult {
    const r = this.stmt.run(...params);
    return { changes: r.changes, lastInsertRowid: BigInt(r.lastInsertRowid) };
  }

  get(...params: unknown[]): T | undefined {
    return this.stmt.get(...params) as T | undefined;
  }

  all(...params: unknown[]): T[] {
    return this.stmt.all(...params) as T[];
  }
}

class BunSqliteDb implements SqliteDb {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
  }

  prepare<T = unknown>(sql: string): SqliteStatement<T> {
    return new BunStatement<T>(this.db.prepare(sql));
  }

  run(sql: string, ...params: unknown[]): RowResult {
    const r = this.db.prepare(sql).run(...params);
    return { changes: r.changes, lastInsertRowid: BigInt(r.lastInsertRowid) };
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}

export function createBunSqliteDb(path: string): SqliteDb {
  return new BunSqliteDb(path);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/storage/bun-sqlite.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/storage/bun-sqlite.ts tests/storage/bun-sqlite.test.ts
git commit -m "feat: bun:sqlite backend implementing SqliteDb interface"
```

---

## Task 4 — DB Factory: PRAGMAs, Auto-init, Nuke-rebuild

**Files:**
- Create: `src/storage/db.ts`
- Create: `tests/storage/db.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/storage/db.test.ts`:

```typescript
import { describe, test, expect, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'node:fs';
import { openDb } from '../../src/storage/db.ts';
import { SCHEMA_VERSION } from '../../src/storage/schema.ts';

const TEST_DB = '/tmp/tsgraph-test-db.db';

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(TEST_DB + suffix); } catch { /* ok */ }
  }
}

afterEach(cleanup);

describe('openDb', () => {
  test('creates all tables on a fresh database', () => {
    const db = openDb(TEST_DB);
    const tables = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .map(r => r.name);
    expect(tables).toContain('files');
    expect(tables).toContain('nodes');
    expect(tables).toContain('edges');
    expect(tables).toContain('tags');
    db.close();
  });

  test('sets user_version to SCHEMA_VERSION', () => {
    const db = openDb(TEST_DB);
    const row = db.get<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    db.close();
  });

  test('WAL journal mode is active', () => {
    const db = openDb(TEST_DB);
    const row = db.get<{ journal_mode: string }>('PRAGMA journal_mode');
    expect(row?.journal_mode).toBe('wal');
    db.close();
  });

  test('reopening preserves existing data', () => {
    const db1 = openDb(TEST_DB);
    db1.run(
      'INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)',
      'src/foo.ts', 'abc', 'def', 1_000_000
    );
    db1.close();

    const db2 = openDb(TEST_DB);
    const files = db2.all<{ path: string }>('SELECT path FROM files');
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/foo.ts');
    db2.close();
  });

  test('nuke-rebuilds when user_version does not match', () => {
    // Seed a db with data, then corrupt its version
    const db1 = openDb(TEST_DB);
    db1.run(
      'INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)',
      'src/foo.ts', 'abc', 'def', 1_000_000
    );
    db1.run('PRAGMA user_version = 999');
    db1.close();

    // Reopen — should detect mismatch, wipe, and rebuild
    const db2 = openDb(TEST_DB);
    const files = db2.all('SELECT * FROM files');
    expect(files).toHaveLength(0);
    const row = db2.get<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(SCHEMA_VERSION);
    db2.close();
  });

  test('autoincrement IDs do not reuse deleted rowids', () => {
    const db = openDb(TEST_DB);
    db.run(
      'INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)',
      'a.ts', 'h1', 's1', 1
    );
    db.run(
      'INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)',
      'b.ts', 'h2', 's2', 2
    );
    db.run("DELETE FROM files WHERE path = 'a.ts'");
    const r = db.run(
      'INSERT INTO files (path, content_hash, shape_hash, analyzed_at) VALUES (?, ?, ?, ?)',
      'c.ts', 'h3', 's3', 3
    );
    // AUTOINCREMENT guarantees new ID > any previously used ID
    expect(r.lastInsertRowid).toBeGreaterThan(2n);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/storage/db.test.ts
```

Expected: FAIL — `Cannot find module '../../src/storage/db.ts'`

- [ ] **Step 3: Create `src/storage/db.ts`**

```typescript
import { unlinkSync } from 'node:fs';
import { createBunSqliteDb } from './bun-sqlite.ts';
import { SCHEMA_VERSION, SCHEMA_STATEMENTS } from './schema.ts';
import type { SqliteDb } from './interface.ts';

export function openDb(path: string): SqliteDb {
  const db = createBunSqliteDb(path);

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA busy_timeout=5000');

  const versionRow = db.get<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion === 0) {
    db.transaction(() => {
      for (const stmt of SCHEMA_STATEMENTS) {
        db.run(stmt);
      }
      db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    return db;
  }

  if (currentVersion !== SCHEMA_VERSION) {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(path + suffix); } catch { /* already gone */ }
    }
    return openDb(path);
  }

  return db;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/storage/db.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
bun test
```

Expected: all tests across schema, bun-sqlite, and db pass.

- [ ] **Step 6: Commit**

```bash
git add src/storage/db.ts tests/storage/db.test.ts
git commit -m "feat: openDb factory — PRAGMAs, auto-schema-init, nuke-rebuild on version mismatch"
```

---

## Task 5 — Prototype A: @mapequation/infomap

**Files:**
- Create: `prototypes/infomap-bun.ts`

- [ ] **Step 1: Create `prototypes/infomap-bun.ts`**

```typescript
#!/usr/bin/env bun
/**
 * Prototype A: @mapequation/infomap in Bun
 *
 * Validates that the package can instantiate and .run() in:
 *   1. Dev mode:      bun run prototypes/infomap-bun.ts
 *   2. Compiled mode: bun build --compile prototypes/infomap-bun.ts --outfile /tmp/proto-infomap
 *                     /tmp/proto-infomap
 *
 * EXIT 0 = PASS, EXIT 1 = FAIL
 * If compiled mode fails, see docs/spec.md §Community detection for the subprocess fallback.
 */

import Infomap from '@mapequation/infomap';

const SMALL_NETWORK = `*Vertices 4
1 "a"
2 "b"
3 "c"
4 "d"
*Edges
1 2 1.0
2 3 1.0
3 1 1.0
1 4 0.5`.trim();

async function main(): Promise<void> {
  console.log('=== Prototype A: @mapequation/infomap ===');

  let infomap: InstanceType<typeof Infomap>;
  try {
    infomap = new Infomap();
    console.log('✓ new Infomap() succeeded');
  } catch (err) {
    console.error('✗ new Infomap() threw:', err);
    process.exit(1);
  }

  try {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timeout: infomap did not emit "data" within 15s')),
        15_000
      );
      infomap
        .on('data', (data: Record<string, unknown>) => { clearTimeout(timer); resolve(data); })
        .on('error', (msg: string) => { clearTimeout(timer); reject(new Error(msg)); })
        .run({ network: SMALL_NETWORK, args: '--seed 42 --num-trials 1 --silent' });
    });

    console.log('✓ .run() completed');
    console.log('  result keys:', Object.keys(result).join(', '));
    const communities = (result as { communities?: unknown[] }).communities;
    if (Array.isArray(communities)) {
      console.log('  communities found:', communities.length);
    }
    console.log('PASS');
    process.exit(0);
  } catch (err) {
    console.error('✗ .run() failed:', err instanceof Error ? err.message : String(err));
    console.error('');
    console.error('Fallback: spawn native infomap CLI subprocess');
    console.error('  See docs/spec.md §Community detection §Fallback');
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Run in dev mode and record result**

```bash
bun run proto:infomap
```

Record whether this prints PASS or FAIL. If FAIL in dev mode, the package itself is broken — check npm for the correct import API.

- [ ] **Step 3: Compile to a standalone binary**

```bash
bun build --compile prototypes/infomap-bun.ts --outfile /tmp/proto-infomap
```

If this step fails (e.g. WASM bundling error), that is itself a finding — record the error.

- [ ] **Step 4: Run the compiled binary**

```bash
/tmp/proto-infomap
```

Record the exit code and output. This is the critical test.

- [ ] **Step 5: Record findings in `prototypes/RESULTS.md`**

Create `prototypes/RESULTS.md` with the following template filled in:

```markdown
# Prototype Results

## A — @mapequation/infomap

| Mode     | Result | Notes |
|----------|--------|-------|
| dev      | PASS/FAIL | |
| compiled | PASS/FAIL | |

Error output (if any):
\```
<paste error here>
\```

**Decision:**
- PASS compiled → proceed with infomap in production code
- FAIL compiled → implement subprocess fallback before Phase 2
```

- [ ] **Step 6: Commit**

```bash
git add prototypes/infomap-bun.ts prototypes/RESULTS.md
git commit -m "proto: @mapequation/infomap Bun compiled-binary validation"
```

---

## Task 6 — Prototype B: web-tree-sitter WASM

**Files:**
- Create: `prototypes/tree-sitter-bun.ts`

- [ ] **Step 1: Create `prototypes/tree-sitter-bun.ts`**

```typescript
#!/usr/bin/env bun
/**
 * Prototype B: web-tree-sitter WASM grammar in Bun
 *
 * Validates that a WASM grammar can be loaded inside:
 *   1. Dev mode:      bun run prototypes/tree-sitter-bun.ts
 *   2. Compiled mode: bun build --compile prototypes/tree-sitter-bun.ts --outfile /tmp/proto-ts
 *                     /tmp/proto-ts
 *
 * EXIT 0 = PASS, EXIT 1 = FAIL
 *
 * WASM loading strategy tested here: Language.load(Buffer) from node_modules path.
 * If this fails only in compiled mode, the fix is to embed the WASM via --asset flag:
 *   bun build --compile ... --asset tree-sitter-typescript/typescript.wasm
 * See docs/spec.md §AST pre-pass for context.
 */

import Parser from 'web-tree-sitter';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TS_SNIPPET = `
const greet = (name: string): string => {
  return \`Hello, \${name}!\`;
};
const x: number = 42;
`.trim();

async function main(): Promise<void> {
  console.log('=== Prototype B: web-tree-sitter ===');

  try {
    await Parser.init();
    console.log('✓ Parser.init() succeeded');
  } catch (err) {
    console.error('✗ Parser.init() failed:', err);
    process.exit(1);
  }

  // Attempt to locate tree-sitter-typescript WASM
  const candidates = [
    join(__dirname, '../node_modules/tree-sitter-typescript/typescript.wasm'),
    join(process.cwd(), 'node_modules/tree-sitter-typescript/typescript.wasm'),
  ];

  let wasmBytes: Buffer | null = null;
  let wasmPath = '';
  for (const p of candidates) {
    try {
      wasmBytes = readFileSync(p);
      wasmPath = p;
      break;
    } catch { /* try next */ }
  }

  if (!wasmBytes) {
    console.error('✗ Could not find typescript.wasm in node_modules');
    console.error('  Run: bun add tree-sitter-typescript');
    process.exit(1);
  }

  console.log('✓ WASM located at:', wasmPath);

  let lang: Parser.Language;
  try {
    lang = await Parser.Language.load(wasmBytes);
    console.log('✓ Language.load(Buffer) succeeded');
  } catch (err) {
    console.error('✗ Language.load() failed:', err instanceof Error ? err.message : String(err));
    console.error('');
    console.error('In compiled mode, try embedding WASM with --asset flag');
    process.exit(1);
  }

  try {
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(TS_SNIPPET);

    console.log('✓ Parsed snippet, root node type:', tree.rootNode.type);

    const arrowFns = tree.rootNode.descendantsOfType('arrow_function');
    console.log('✓ Arrow function nodes found:', arrowFns.length);
    expect(arrowFns.length > 0, 'should find at least one arrow function');

    const identifiers = tree.rootNode.descendantsOfType('identifier');
    console.log('  Identifiers:', identifiers.map(n => n.text).join(', '));

    console.log('PASS');
    process.exit(0);
  } catch (err) {
    console.error('✗ Parse failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function expect(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`✗ Assertion failed: ${msg}`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Install tree-sitter-typescript grammar**

```bash
bun add tree-sitter-typescript
```

Expected: package added with a `typescript.wasm` file in `node_modules/tree-sitter-typescript/`.

Verify:

```bash
ls node_modules/tree-sitter-typescript/*.wasm
```

- [ ] **Step 3: Run in dev mode**

```bash
bun run proto:tree-sitter
```

Record PASS or FAIL.

- [ ] **Step 4: Compile to standalone binary**

```bash
bun build --compile prototypes/tree-sitter-bun.ts --outfile /tmp/proto-ts
```

If Bun supports `--asset` flags for embedding binary assets:

```bash
bun build --compile prototypes/tree-sitter-bun.ts \
  --asset node_modules/tree-sitter-typescript/typescript.wasm \
  --outfile /tmp/proto-ts
```

Record whether the compile step itself errors.

- [ ] **Step 5: Run the compiled binary**

```bash
/tmp/proto-ts
```

Record exit code and output.

- [ ] **Step 6: Update `prototypes/RESULTS.md`**

Append:

```markdown
## B — web-tree-sitter WASM

| Mode     | Result | Notes |
|----------|--------|-------|
| dev      | PASS/FAIL | |
| compiled | PASS/FAIL | |

Error output (if any):
\```
<paste error here>
\```

**Decision:**
- PASS compiled (path strategy) → proceed with readFileSync from node_modules in dev, document that compiled binary requires --asset or side-car WASM
- FAIL compiled → implement --asset embed strategy or side-car WASM before Phase 2
```

- [ ] **Step 7: Commit**

```bash
git add prototypes/tree-sitter-bun.ts prototypes/RESULTS.md
git commit -m "proto: web-tree-sitter WASM compiled-binary validation"
```

---

## Task 7 — Prototype Validation Runner

**Files:**
- Create: `scripts/validate-prototypes.ts`

- [ ] **Step 1: Create `scripts/validate-prototypes.ts`**

```typescript
#!/usr/bin/env bun
/**
 * Runs both prototypes in dev mode and compiled mode.
 * Prints a clear PASS/FAIL table and exits non-zero if anything fails.
 *
 * Run: bun run proto:all
 */

import { spawnSync } from 'node:child_process';
import { unlinkSync, existsSync } from 'node:fs';

interface Result {
  name: string;
  devPass: boolean;
  compiledPass: boolean;
  compiledSkipped: boolean;
  notes: string;
}

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30_000 });
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

function probe(name: string, file: string, binary: string): Result {
  const result: Result = { name, devPass: false, compiledPass: false, compiledSkipped: false, notes: '' };

  process.stdout.write(`\n[${name}] dev mode... `);
  const dev = run('bun', ['run', file]);
  result.devPass = dev.ok;
  process.stdout.write(dev.ok ? 'PASS\n' : 'FAIL\n');

  process.stdout.write(`[${name}] compiling... `);
  const compile = run('bun', ['build', '--compile', file, '--outfile', binary]);
  if (!compile.ok) {
    process.stdout.write('COMPILE ERROR\n');
    result.compiledSkipped = true;
    result.notes = compile.out.slice(0, 300);
    return result;
  }
  process.stdout.write('OK\n');

  process.stdout.write(`[${name}] compiled binary... `);
  const compiled = run(binary, []);
  result.compiledPass = compiled.ok;
  process.stdout.write(compiled.ok ? 'PASS\n' : 'FAIL\n');
  if (!compiled.ok) result.notes = compiled.out.slice(0, 300);

  try { unlinkSync(binary); } catch { /* ok */ }
  return result;
}

const PROBES = [
  { name: 'infomap',      file: 'prototypes/infomap-bun.ts',      binary: '/tmp/proto-infomap' },
  { name: 'tree-sitter',  file: 'prototypes/tree-sitter-bun.ts',  binary: '/tmp/proto-ts' },
];

const results = PROBES.map(p => probe(p.name, p.file, p.binary));

console.log('\n╔══════════════════════════════════════════╗');
console.log('║       PROTOTYPE VALIDATION RESULTS       ║');
console.log('╠══════════════════════════════════════════╣');
for (const r of results) {
  const devStr      = r.devPass             ? '✓ PASS' : '✗ FAIL';
  const compiledStr = r.compiledSkipped     ? '— SKIP'
                    : r.compiledPass        ? '✓ PASS' : '✗ FAIL';
  console.log(`║  ${r.name.padEnd(12)} dev: ${devStr}  compiled: ${compiledStr}  ║`);
  if (r.notes) console.log(`║    note: ${r.notes.slice(0, 34).padEnd(34)}  ║`);
}
console.log('╚══════════════════════════════════════════╝');

const allPass = results.every(r => r.devPass && r.compiledPass);
if (allPass) {
  console.log('\n✓ All prototypes PASS. Safe to proceed to Phase 2 (Graph Engine).');
  process.exit(0);
} else {
  console.log('\n✗ One or more prototypes FAILED in compiled mode.');
  console.log('  Do NOT write production graph code until fallbacks are implemented.');
  console.log('  See prototypes/RESULTS.md and docs/spec.md §Known risks.\n');
  process.exit(1);
}
```

- [ ] **Step 2: Run the validation script**

```bash
bun run proto:all
```

This runs both prototypes sequentially and prints a PASS/FAIL table. Record the output in `prototypes/RESULTS.md`.

- [ ] **Step 3: Typecheck everything**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run the full test suite one final time**

```bash
bun test
```

Expected: all storage tests pass.

- [ ] **Step 5: Final commit**

```bash
git add scripts/validate-prototypes.ts prototypes/RESULTS.md
git commit -m "feat: prototype validation runner + final results"
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Day-1: infomap in compiled binary | Task 5 |
| Day-1: web-tree-sitter WASM in compiled binary | Task 6 |
| SQLite abstraction interface | Task 2 |
| bun:sqlite implementation | Task 3 |
| PRAGMA journal_mode=WAL | Task 4 |
| PRAGMA busy_timeout=5000 | Task 4 |
| PRAGMA user_version check + nuke-rebuild | Task 4 |
| AUTOINCREMENT PKs to prevent ID reuse | Task 2 (schema) + Task 4 (test) |
| CLI skeleton for build/query/explain-edges | Task 1 |
| Schema: files, nodes, edges, tags, indexes | Task 2 |
| Prototype validation runner | Task 7 |

**Items deferred to Plan 2:** parser pre-pass, TypeScript analyzer, graph construction, PageRank, incremental build.

**Items deferred to Plan 3:** tsgraph.toml, query engine, JSON output, community detection, distribution.

**No placeholder check:** all steps contain actual code, exact commands, and expected output. No "TBD" or "fill in later."
