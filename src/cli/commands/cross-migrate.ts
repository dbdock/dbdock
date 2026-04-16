import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { logger } from '../utils/logger';
import {
  analyzeDatabase,
  parseDatabaseUrl,
  generateMigrationPlan,
  executeMigration,
  maskUrl,
} from '../../migration/engines/migration.engine';
import { exportConfig, importConfig } from '../../migration/config.manager';
import {
  MigrationPlan,
  MigrationOptions,
  TableMapping,
  DocumentMapping,
  DEFAULT_MIGRATION_OPTIONS,
  ParsedDatabaseUrl,
  MongoAnalysisResult,
  PgAnalysisResult,
} from '../../migration/types';

interface MigrateOptions {
  dryRun?: boolean;
  incremental?: boolean;
  since?: string;
  config?: string;
  exportConfig?: string;
  batchSize?: number;
  maxDepth?: number;
}

export async function crossMigrateCommand(
  sourceUrl: string,
  targetUrl: string,
  options: MigrateOptions,
): Promise<void> {
  console.log('');
  console.log(chalk.bold('  DBDock - Cross-Database Migration'));
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log('');

  if (options.config) {
    await runFromConfig(options.config, sourceUrl, targetUrl, options);
    return;
  }

  let sourceParsed: ParsedDatabaseUrl;
  let targetParsed: ParsedDatabaseUrl;
  try {
    sourceParsed = parseDatabaseUrl(sourceUrl);
    targetParsed = parseDatabaseUrl(targetUrl);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (sourceParsed.type === targetParsed.type) {
    logger.error(
      `Source and target are both ${sourceParsed.type}. Cross-database migration requires different database types.`,
    );
    logger.info(
      'For same-database copies, use: dbdock copydb <source> <target>',
    );
    process.exit(1);
  }

  const sourceLabel =
    sourceParsed.type === 'mongodb' ? 'MongoDB' : 'PostgreSQL';
  const targetLabel =
    targetParsed.type === 'mongodb' ? 'MongoDB' : 'PostgreSQL';

  logger.info(`Source: ${chalk.cyan(sourceLabel)} — ${sourceParsed.database}`);
  logger.info(`Target: ${chalk.cyan(targetLabel)} — ${targetParsed.database}`);

  if (options.dryRun) {
    logger.info(`Mode: ${chalk.yellow('Dry Run')} (no changes to target)`);
  }
  if (options.incremental) {
    logger.info(
      `Mode: ${chalk.yellow('Incremental')}${options.since ? ` since ${options.since}` : ''}`,
    );
  }
  console.log('');

  const spinner = ora('Analyzing source database...').start();

  let analysis: MongoAnalysisResult | PgAnalysisResult;
  try {
    analysis = await analyzeDatabase(sourceUrl);
  } catch (error) {
    spinner.fail('Failed to analyze source database');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (analysis.type === 'mongodb') {
    spinner.succeed(
      `Source analyzed: ${analysis.collections.length} collections, ${formatNumber(analysis.totalDocuments)} documents`,
    );
  } else {
    spinner.succeed(
      `Source analyzed: ${analysis.tables.length} tables, ${formatNumber(analysis.totalRows)} rows`,
    );
  }

  console.log('');

  const migrationOptions: Partial<MigrationOptions> = {
    ...DEFAULT_MIGRATION_OPTIONS,
    dryRun: options.dryRun || false,
    incremental: options.incremental || false,
    since: options.since,
    batchSize: options.batchSize || DEFAULT_MIGRATION_OPTIONS.batchSize,
    maxNestingDepth:
      options.maxDepth || DEFAULT_MIGRATION_OPTIONS.maxNestingDepth,
  };

  const plan = generateMigrationPlan(
    analysis,
    sourceUrl,
    targetUrl,
    migrationOptions,
  );

  displayMigrationPlan(plan);

  if (options.exportConfig) {
    try {
      exportConfig(plan, options.exportConfig);
      logger.success(`Config exported to ${options.exportConfig}`);
    } catch (error) {
      logger.error(
        `Failed to export config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  const { action } = (await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Accept mapping?',
      choices: [
        { name: 'Yes — execute migration', value: 'accept' },
        { name: 'Export config file — save and edit later', value: 'export' },
        { name: 'Cancel', value: 'cancel' },
      ],
    },
  ])) as { action: 'accept' | 'export' | 'cancel' };

  if (action === 'cancel') {
    logger.warn('Migration cancelled');
    return;
  }

  if (action === 'export') {
    const { path } = (await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: 'Config file path:',
        default: './migration.yaml',
      },
    ])) as { path: string };
    try {
      exportConfig(plan, path);
      logger.success(`Config exported to ${path}`);
      logger.info(
        `Re-run with: dbdock migrate --config ${path} "${maskUrl(sourceUrl)}" "${maskUrl(targetUrl)}"`,
      );
    } catch (error) {
      logger.error(
        `Failed to export: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }

  console.log('');
  await executeMigrationWithProgress(plan);
}

async function runFromConfig(
  configPath: string,
  sourceUrl: string,
  targetUrl: string,
  options: MigrateOptions,
): Promise<void> {
  const spinner = ora(`Loading config from ${configPath}...`).start();

  let plan: MigrationPlan;
  try {
    plan = importConfig(configPath);
    plan.source.url = sourceUrl;
    plan.target.url = targetUrl;

    if (options.dryRun !== undefined) plan.options.dryRun = options.dryRun;
    if (options.incremental !== undefined)
      plan.options.incremental = options.incremental;
    if (options.since) plan.options.since = options.since;
    if (options.batchSize) plan.options.batchSize = options.batchSize;

    spinner.succeed('Config loaded');
  } catch (error) {
    spinner.fail('Failed to load config');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log('');
  displayMigrationPlan(plan);

  const { confirm } = (await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Execute migration with this config?',
      default: false,
    },
  ])) as { confirm: boolean };

  if (!confirm) {
    logger.warn('Migration cancelled');
    return;
  }

  console.log('');
  await executeMigrationWithProgress(plan);
}

async function executeMigrationWithProgress(
  plan: MigrationPlan,
): Promise<void> {
  const startTime = Date.now();
  const migrationSpinner = ora('Starting migration...').start();

  const currentProgress: Record<string, { processed: number; total: number }> =
    {};

  try {
    const result = await executeMigration(plan, (table, processed, total) => {
      currentProgress[table] = { processed, total };
      const totalProcessed = Object.values(currentProgress).reduce(
        (s, p) => s + p.processed,
        0,
      );
      const totalAll = Object.values(currentProgress).reduce(
        (s, p) => s + p.total,
        0,
      );
      const pct =
        totalAll > 0 ? ((totalProcessed / totalAll) * 100).toFixed(1) : '0';
      migrationSpinner.text = `Migrating... ${pct}% (${table}: ${formatNumber(processed)}/${formatNumber(total)})`;
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (result.success) {
      migrationSpinner.succeed(
        `Migration completed in ${elapsed}s${plan.options.dryRun ? ' (dry run)' : ''}`,
      );
    } else {
      migrationSpinner.warn(`Migration completed with issues in ${elapsed}s`);
    }

    console.log('');
    displayResults(result, plan.options.dryRun);
  } catch (error) {
    migrationSpinner.fail('Migration failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function displayMigrationPlan(plan: MigrationPlan): void {
  console.log(chalk.bold('  Proposed Schema Mapping:'));
  console.log('');

  if (plan.direction === 'mongo_to_postgres' && plan.tableMappings) {
    displayTableMappings(plan.tableMappings);
  }

  if (plan.direction === 'postgres_to_mongo' && plan.documentMappings) {
    displayDocumentMappings(plan.documentMappings);
  }

  if (plan.conflicts.length > 0) {
    console.log(chalk.yellow.bold(`  ⚠ Conflicts Found:`));
    console.log('');
    for (const conflict of plan.conflicts) {
      const icon =
        conflict.type === 'type_mismatch'
          ? '•'
          : conflict.type === 'missing_field'
            ? '•'
            : '•';
      console.log(
        `  ${icon} ${chalk.white(conflict.location)}: ${conflict.details}`,
      );
      console.log(
        `    ${chalk.gray('→ Suggestion:')} ${chalk.cyan(conflict.suggestion)}`,
      );
    }
    console.log('');
  }
}

function displayTableMappings(mappings: TableMapping[]): void {
  for (const mapping of mappings) {
    console.log(
      chalk.bold(
        `  ${chalk.green(mapping.sourceCollection)} → ${chalk.cyan(mapping.targetTable)}`,
      ),
    );

    for (const field of mapping.fields) {
      const arrow = field.transform
        ? chalk.yellow(`→ (${field.transform})`)
        : '→';
      const nullable = field.nullable ? chalk.gray(' nullable') : '';
      const pk = field.isPrimaryKey ? chalk.yellow(' PK') : '';
      const unique =
        field.isUnique && !field.isPrimaryKey ? chalk.blue(' UNIQUE') : '';

      console.log(
        `  ├─ ${field.sourceField} ${arrow} ${mapping.targetTable}.${field.targetColumn} ${chalk.gray(`(${field.targetType})`)}${pk}${unique}${nullable}`,
      );
    }

    for (const nested of mapping.nestedMappings) {
      const strategy =
        nested.strategy === 'table'
          ? chalk.blue(`${nested.relationType} relation`)
          : chalk.magenta('jsonb');
      console.log(
        `  ├─ ${nested.sourceField} {} → ${chalk.cyan(nested.targetTable)} ${strategy}`,
      );
      if (nested.fields && nested.strategy === 'table') {
        for (const f of nested.fields.filter(
          (f) => f.sourceField !== 'id' && !f.sourceField.includes('_id'),
        )) {
          console.log(
            `  │   ├─ ${f.sourceField.split('.').pop()} → ${f.targetColumn} ${chalk.gray(`(${f.targetType})`)}`,
          );
        }
      }
    }

    for (const arr of mapping.arrayMappings) {
      const strategyLabel =
        arr.strategy === 'child_table'
          ? chalk.blue('child table')
          : arr.strategy === 'array_column'
            ? chalk.magenta(`${arr.elementType}[]`)
            : chalk.yellow('junction table');
      console.log(
        `  ├─ ${arr.sourceField} [] → ${chalk.cyan(arr.targetTable)} ${strategyLabel}`,
      );
    }

    for (const ref of mapping.detectedReferences) {
      console.log(
        `  ├─ ${ref.sourceField} ${chalk.magenta(`→ FK: ${ref.targetCollection}.id`)}`,
      );
    }

    console.log('');
  }
}

function displayDocumentMappings(mappings: DocumentMapping[]): void {
  for (const mapping of mappings) {
    console.log(
      chalk.bold(
        `  ${chalk.green(mapping.primaryTable)} → ${chalk.cyan(mapping.targetCollection)} collection`,
      ),
    );

    for (const [pgCol, mongoField] of Object.entries(mapping.fieldMappings)) {
      if (pgCol.startsWith('_')) continue;
      console.log(`  ├─ ${pgCol} → ${mongoField}`);
    }

    for (const embed of mapping.embeddings) {
      const type = embed.isArray ? 'embed array' : 'embed object';
      console.log(
        `  ├─ ${chalk.cyan(embed.sourceTable)} → ${chalk.blue(`${type} as ${embed.embedAs}`)}`,
      );
    }

    for (const ref of mapping.references) {
      console.log(
        `  ├─ ${chalk.cyan(ref.sourceTable)} → ${chalk.magenta(`separate collection with ${ref.refField} ref`)}`,
      );
    }

    console.log('');
  }
}

function displayResults(
  result: {
    success: boolean;
    tables: Array<{
      name: string;
      sourceCount: number;
      targetCount: number;
      failedCount: number;
      status: string;
    }>;
    totalErrors: number;
    dryRun: boolean;
  },
  isDryRun: boolean,
): void {
  if (isDryRun) {
    console.log(chalk.bold('  Dry Run Results:'));
  } else {
    console.log(chalk.bold('  Migration Results:'));
  }
  console.log(chalk.gray('  ─'.repeat(20)));

  for (const table of result.tables) {
    const icon =
      table.status === 'success'
        ? chalk.green('✔')
        : table.status === 'partial'
          ? chalk.yellow('⚠')
          : chalk.red('✗');
    const counts = `${formatNumber(table.sourceCount)} → ${formatNumber(table.targetCount)}`;
    const failed =
      table.failedCount > 0 ? chalk.red(` (${table.failedCount} failed)`) : '';
    console.log(`  ${icon} ${table.name}: ${counts}${failed}`);
  }

  console.log('');

  if (result.totalErrors > 0) {
    logger.warn(
      `${result.totalErrors} rows failed (see _migration_errors${isDryRun ? '' : ' table'})`,
    );
  }

  if (result.success) {
    logger.success(
      isDryRun
        ? 'All foreign keys valid — dry run passed'
        : 'Migration completed successfully',
    );
  }

  console.log('');
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
