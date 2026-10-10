import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { getClient, closePool } from './pool.js';

export type MigrationTransactionMode = 'wrapped' | 'not_wrapped';

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  filepath: string;
  upSql: string;
  downSql: string;
  checksum: string;
  inferredTransactionMode?: MigrationTransactionMode;
}

export interface AppliedMigration {
  id: number;
  version: string;
  name: string;
  checksum: string;
  transaction_mode: string;
  applied_at: Date;
  execution_time_ms: number;
}

export interface MigrationRunnerOptions {
  migrationsDir?: string;
  defaultTransactionMode?: MigrationTransactionMode;
  steps?: number;
}

const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

/**
 * Ensure the tracking table exists.
 */
export async function ensureMigrationTable(client: PoolClient): Promise<void> {
  const ddl = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      transaction_mode VARCHAR(32) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_time_ms INTEGER NOT NULL
    );
  `;
  await client.query(ddl);
}

/**
 * Fetch all applied migrations ordered by version ascending.
 */
export async function getAppliedMigrations(client: PoolClient): Promise<AppliedMigration[]> {
  await ensureMigrationTable(client);
  const res = await client.query<AppliedMigration>(
    'SELECT id, version, name, checksum, transaction_mode, applied_at, execution_time_ms FROM schema_migrations ORDER BY version ASC'
  );
  return res.rows;
}

function cleanDownSql(downRaw: string): string {
  const lines = downRaw.split('\n');
  const uncommented = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) {
      return trimmed.replace(/^--\s?/, '');
    }
    return line;
  });
  return uncommented.join('\n').trim();
}

/**
 * Parse an SQL migration file, extracting -- Up and -- Down sections if present,
 * and scanning for in-file directives like `-- transaction-mode: not_wrapped`.
 */
export function parseMigrationContent(rawContent: string): {
  upSql: string;
  downSql: string;
  inferredTransactionMode?: MigrationTransactionMode;
} {
  let inferredTransactionMode: MigrationTransactionMode | undefined;

  // Check for in-file directives
  const modeMatch = rawContent.match(/--\s*transaction-mode:\s*(wrapped|not_wrapped)/i);
  if (modeMatch) {
    inferredTransactionMode = modeMatch[1].toLowerCase() as MigrationTransactionMode;
  } else if (/--\s*transaction:\s*false/i.test(rawContent)) {
    inferredTransactionMode = 'not_wrapped';
  } else if (/--\s*transaction:\s*true/i.test(rawContent)) {
    inferredTransactionMode = 'wrapped';
  }

  // Check for section markers
  const upHeader = rawContent.match(/--\s*Up[^\r\n]*/i);
  const downHeader = rawContent.match(/--\s*Down[^\r\n]*/i);

  if (upHeader && downHeader && upHeader.index !== undefined && downHeader.index !== undefined) {
    let upRaw = '';
    let downRaw = '';
    if (upHeader.index < downHeader.index) {
      upRaw = rawContent.substring(upHeader.index + upHeader[0].length, downHeader.index).trim();
      downRaw = rawContent.substring(downHeader.index + downHeader[0].length).trim();
    } else {
      downRaw = rawContent.substring(downHeader.index + downHeader[0].length, upHeader.index).trim();
      upRaw = rawContent.substring(upHeader.index + upHeader[0].length).trim();
    }
    const downSql = cleanDownSql(downRaw);
    return { upSql: upRaw, downSql, inferredTransactionMode };
  } else if (upHeader && upHeader.index !== undefined && !downHeader) {
    const upSql = rawContent.substring(upHeader.index + upHeader[0].length).trim();
    return { upSql, downSql: '', inferredTransactionMode };
  }

  // No markers: entire file is Up migration
  return {
    upSql: rawContent.trim(),
    downSql: '',
    inferredTransactionMode,
  };
}

/**
 * Discover and load all migration files in migrations directory.
 */
export function loadMigrationFiles(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const entries = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));
  entries.sort();

  const migrations: MigrationFile[] = [];

  for (const file of entries) {
    const fullPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Parse filename: format expected: <version>_<name>.sql or <version>_<name>.[up|down].sql
    const baseName = path.basename(file, '.sql');
    const versionMatch = baseName.match(/^([0-9]{3,}|[0-9]{14})_(.*)$/);
    const version = versionMatch ? versionMatch[1] : baseName;
    const name = versionMatch ? versionMatch[2] : baseName;

    const { upSql, downSql, inferredTransactionMode } = parseMigrationContent(content);
    const checksum = crypto.createHash('sha256').update(upSql).digest('hex');

    migrations.push({
      version,
      name,
      filename: file,
      filepath: fullPath,
      upSql,
      downSql,
      checksum,
      inferredTransactionMode,
    });
  }

  return migrations;
}

/**
 * Run migrations UP.
 */
export async function migrateUp(options: MigrationRunnerOptions = {}): Promise<MigrationFile[]> {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const defaultMode = options.defaultTransactionMode || 'wrapped';
  const steps = options.steps ?? Infinity;

  const client = await getClient();
  try {
    await ensureMigrationTable(client);
    const applied = await getAppliedMigrations(client);
    const appliedMap = new Map(applied.map((m) => [m.version, m]));

    const allFiles = loadMigrationFiles(migrationsDir);

    // Step 1: Verify checksums of applied migrations
    for (const file of allFiles) {
      const recorded = appliedMap.get(file.version);
      if (recorded) {
        if (recorded.checksum !== file.checksum) {
          throw new Error(
            `[Migration Integrity Error] Checksum mismatch for migration '${file.version}' (${file.filename})!\n` +
            `  Database record checksum: ${recorded.checksum}\n` +
            `  Current file checksum:    ${file.checksum}\n` +
            `Migration files must not be altered once applied to preserve database integrity.`
          );
        }
      }
    }

    // Step 2: Identify pending migrations
    const pending = allFiles.filter((file) => !appliedMap.has(file.version));
    if (pending.length === 0) {
      console.log('Database is up to date. No pending migrations.');
      return [];
    }

    const toApply = pending.slice(0, steps);
    console.log(`Applying ${toApply.length} migration(s)...`);

    const executed: MigrationFile[] = [];

    for (const migration of toApply) {
      const mode: MigrationTransactionMode = migration.inferredTransactionMode || defaultMode;
      console.log(`\n--> Migrating UP: ${migration.filename} (mode: ${mode})`);
      const startTime = Date.now();

      if (mode === 'wrapped') {
        try {
          await client.query('BEGIN');
          await client.query(migration.upSql);
          const duration = Date.now() - startTime;

          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum, transaction_mode, execution_time_ms)
             VALUES ($1, $2, $3, $4, $5)`,
            [migration.version, migration.name, migration.checksum, mode, duration]
          );
          await client.query('COMMIT');
          console.log(`  ✓ Applied ${migration.filename} (${duration}ms)`);
          executed.push(migration);
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error(`  ✗ Failed ${migration.filename} (rolled back):`, err.message);
          throw err;
        }
      } else {
        // 'not_wrapped': executes without transaction wrapper (e.g. for CREATE INDEX CONCURRENTLY)
        try {
          await client.query(migration.upSql);
          const duration = Date.now() - startTime;

          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum, transaction_mode, execution_time_ms)
             VALUES ($1, $2, $3, $4, $5)`,
            [migration.version, migration.name, migration.checksum, mode, duration]
          );
          console.log(`  ✓ Applied non-transactionally ${migration.filename} (${duration}ms)`);
          executed.push(migration);
        } catch (err: any) {
          console.error(`  ✗ Failed ${migration.filename}:`, err.message);
          throw err;
        }
      }
    }

    console.log(`\nSuccessfully applied ${executed.length} migration(s).`);
    return executed;
  } finally {
    client.release();
  }
}

/**
 * Run migrations DOWN.
 */
export async function migrateDown(options: MigrationRunnerOptions = {}): Promise<MigrationFile[]> {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const defaultMode = options.defaultTransactionMode || 'wrapped';
  const steps = options.steps ?? 1;

  const client = await getClient();
  try {
    await ensureMigrationTable(client);
    const applied = await getAppliedMigrations(client);

    if (applied.length === 0) {
      console.log('No applied migrations to revert.');
      return [];
    }

    const allFiles = loadMigrationFiles(migrationsDir);
    const filesByVersion = new Map(allFiles.map((f) => [f.version, f]));

    // Reverse applied migrations for down order
    const toRevert = applied.slice().reverse().slice(0, steps);
    console.log(`Rolling back ${toRevert.length} migration(s)...`);

    const reverted: MigrationFile[] = [];

    for (const record of toRevert) {
      const file = filesByVersion.get(record.version);
      if (!file) {
        throw new Error(`Cannot rollback version ${record.version}: migration file not found on disk.`);
      }

      if (!file.downSql || file.downSql.trim() === '') {
        throw new Error(
          `Cannot rollback migration ${file.filename}: no '-- Down' section specified in migration file.`
        );
      }

      const mode: MigrationTransactionMode = file.inferredTransactionMode || defaultMode;
      console.log(`\n<-- Migrating DOWN: ${file.filename} (mode: ${mode})`);
      const startTime = Date.now();

      if (mode === 'wrapped') {
        try {
          await client.query('BEGIN');
          await client.query(file.downSql);
          await client.query('DELETE FROM schema_migrations WHERE version = $1', [record.version]);
          await client.query('COMMIT');
          const duration = Date.now() - startTime;
          console.log(`  ✓ Reverted ${file.filename} (${duration}ms)`);
          reverted.push(file);
        } catch (err: any) {
          await client.query('ROLLBACK');
          console.error(`  ✗ Failed to revert ${file.filename} (rolled back):`, err.message);
          throw err;
        }
      } else {
        try {
          await client.query(file.downSql);
          await client.query('DELETE FROM schema_migrations WHERE version = $1', [record.version]);
          const duration = Date.now() - startTime;
          console.log(`  ✓ Reverted non-transactionally ${file.filename} (${duration}ms)`);
          reverted.push(file);
        } catch (err: any) {
          console.error(`  ✗ Failed to revert ${file.filename}:`, err.message);
          throw err;
        }
      }
    }

    console.log(`\nSuccessfully reverted ${reverted.length} migration(s).`);
    return reverted;
  } finally {
    client.release();
  }
}

/**
 * Display migration status table.
 */
export async function migrationStatus(options: MigrationRunnerOptions = {}): Promise<void> {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const client = await getClient();
  try {
    await ensureMigrationTable(client);
    const applied = await getAppliedMigrations(client);
    const appliedMap = new Map(applied.map((m) => [m.version, m]));

    const allFiles = loadMigrationFiles(migrationsDir);

    console.log('\n--- FlashCart Migration Status ---');
    console.log(
      'Status'.padEnd(10) +
      'Version'.padEnd(16) +
      'Name'.padEnd(35) +
      'Mode'.padEnd(14) +
      'Applied At / Execution'
    );
    console.log('-'.repeat(95));

    for (const file of allFiles) {
      const rec = appliedMap.get(file.version);
      if (rec) {
        const timeStr = `${new Date(rec.applied_at).toISOString()} (${rec.execution_time_ms}ms)`;
        console.log(
          'APPLIED'.padEnd(10) +
          file.version.padEnd(16) +
          file.name.slice(0, 33).padEnd(35) +
          rec.transaction_mode.padEnd(14) +
          timeStr
        );
      } else {
        console.log(
          'PENDING'.padEnd(10) +
          file.version.padEnd(16) +
          file.name.slice(0, 33).padEnd(35) +
          (file.inferredTransactionMode || 'default').padEnd(14) +
          'Pending execution'
        );
      }
    }
    console.log('-'.repeat(95));
    console.log(`Total: ${allFiles.length} | Applied: ${applied.length} | Pending: ${allFiles.length - applied.length}\n`);
  } finally {
    client.release();
  }
}

/**
 * CLI Entrypoint.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  // Parse CLI flags
  let transactionMode: MigrationTransactionMode = 'wrapped';
  let steps: number | undefined;
  let migrationsDir = DEFAULT_MIGRATIONS_DIR;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--migration-transaction-mode' && args[i + 1]) {
      const mode = args[i + 1].toLowerCase();
      if (mode === 'wrapped' || mode === 'not_wrapped') {
        transactionMode = mode;
      } else {
        console.error(`Invalid --migration-transaction-mode: ${args[i + 1]}. Expected 'wrapped' or 'not_wrapped'.`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--steps' && args[i + 1]) {
      steps = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dir' && args[i + 1]) {
      migrationsDir = path.resolve(process.cwd(), args[i + 1]);
      i++;
    }
  }

  try {
    switch (command) {
      case 'up':
        await migrateUp({ defaultTransactionMode: transactionMode, steps, migrationsDir });
        break;
      case 'down':
        await migrateDown({ defaultTransactionMode: transactionMode, steps, migrationsDir });
        break;
      case 'status':
        await migrationStatus({ migrationsDir });
        break;
      case 'redo':
        await migrateDown({ defaultTransactionMode: transactionMode, steps: 1, migrationsDir });
        await migrateUp({ defaultTransactionMode: transactionMode, steps: 1, migrationsDir });
        break;
      default:
        console.log(`Unknown command: ${command}`);
        console.log('Usage: tsx src/db/migrate.ts [up|down|status|redo] [--migration-transaction-mode wrapped|not_wrapped] [--steps <n>]');
        process.exit(1);
    }
  } catch (err: any) {
    console.error('[Migration Runner Error]', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

// Run CLI if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
