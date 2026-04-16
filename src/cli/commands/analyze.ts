import ora from 'ora';
import chalk from 'chalk';
import { logger } from '../utils/logger';
import {
  analyzeDatabase,
  parseDatabaseUrl,
} from '../../migration/engines/migration.engine';
import {
  MongoAnalysisResult,
  MongoFieldInfo,
  PgAnalysisResult,
} from '../../migration/types';

export async function analyzeCommand(url: string): Promise<void> {
  console.log('');
  console.log(chalk.bold('  DBDock - Database Analysis'));
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log('');

  let parsed;
  try {
    parsed = parseDatabaseUrl(url);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  logger.info(
    `Database: ${chalk.cyan(parsed.type === 'mongodb' ? 'MongoDB' : 'PostgreSQL')} — ${parsed.database}`,
  );
  logger.info(`Host: ${parsed.host}:${parsed.port}`);
  console.log('');

  const spinner = ora('Analyzing database structure...').start();

  try {
    const analysis = await analyzeDatabase(url);
    spinner.succeed('Analysis complete');
    console.log('');

    if (analysis.type === 'mongodb') {
      displayMongoAnalysis(analysis);
    } else {
      displayPostgresAnalysis(analysis);
    }
  } catch (error) {
    spinner.fail('Analysis failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function displayMongoAnalysis(analysis: MongoAnalysisResult): void {
  console.log(
    chalk.bold(
      `  Found ${chalk.cyan(String(analysis.collections.length))} collections, ${chalk.cyan(formatNumber(analysis.totalDocuments))} total documents`,
    ),
  );
  console.log('');

  for (const collection of analysis.collections) {
    console.log(
      chalk.bold(
        `  ${chalk.green(collection.name)} ${chalk.gray(`(${formatNumber(collection.documentCount)} docs)`)}`,
      ),
    );

    for (let i = 0; i < collection.fields.length; i++) {
      const field = collection.fields[i];
      const isLast = i === collection.fields.length - 1;
      const prefix = isLast ? '  └─' : '  ├─';
      displayMongoField(field, prefix, isLast ? '    ' : '  │ ');
    }

    console.log('');
  }
}

function displayMongoField(
  field: MongoFieldInfo,
  prefix: string,
  childPrefix: string,
): void {
  const typeEntries = Object.entries(field.types).filter(
    ([t]) => t !== 'null' && t !== 'undefined',
  );
  const typeStr = typeEntries
    .map(([t, c]) => {
      if (typeEntries.length > 1) return `${t}(${c})`;
      return t;
    })
    .join(', ');

  let extra = '';
  if (field.frequency < 100) {
    extra += chalk.yellow(` [${field.frequency.toFixed(0)}% present]`);
  }
  if (field.isArray) {
    extra += chalk.blue(` [array: ${field.arrayElementType || 'mixed'}]`);
  }
  if (field.isObjectId && field.name !== '_id') {
    extra += chalk.magenta(
      ` → ref${field.possibleReference ? `: ${field.possibleReference}` : ''}`,
    );
  }
  if (typeEntries.length > 1) {
    extra += chalk.red(' ⚠ mixed types');
  }

  console.log(
    `${prefix} ${chalk.white(field.name)} ${chalk.gray(`(${typeStr})`)}${extra}`,
  );

  if (field.nestedFields && field.isNestedObject && !field.isArray) {
    for (let i = 0; i < field.nestedFields.length; i++) {
      const nested = field.nestedFields[i];
      const isLast = i === field.nestedFields.length - 1;
      const nPrefix = childPrefix + (isLast ? '  └─' : '  ├─');
      const nChildPrefix = childPrefix + (isLast ? '    ' : '  │ ');
      displayMongoField(nested, nPrefix, nChildPrefix);
    }
  }
}

function displayPostgresAnalysis(analysis: PgAnalysisResult): void {
  console.log(
    chalk.bold(
      `  Found ${chalk.cyan(String(analysis.tables.length))} tables, ${chalk.cyan(formatNumber(analysis.totalRows))} total rows`,
    ),
  );
  console.log('');

  for (const table of analysis.tables) {
    console.log(
      chalk.bold(
        `  ${chalk.green(table.name)} ${chalk.gray(`(${formatNumber(table.rowCount)} rows)`)}`,
      ),
    );

    for (let i = 0; i < table.columns.length; i++) {
      const col = table.columns[i];
      const isLast =
        i === table.columns.length - 1 && table.foreignKeys.length === 0;
      const prefix = isLast ? '  └─' : '  ├─';

      let extra = '';
      if (col.isPrimaryKey) extra += chalk.yellow(' PK');
      if (col.isUnique && !col.isPrimaryKey) extra += chalk.blue(' UNIQUE');
      if (!col.isNullable) extra += chalk.gray(' NOT NULL');
      if (col.columnDefault)
        extra += chalk.gray(` DEFAULT ${col.columnDefault}`);

      const fk = table.foreignKeys.find((f) => f.columnName === col.name);
      if (fk) {
        extra += chalk.magenta(
          ` → ${fk.referencedTable}.${fk.referencedColumn}`,
        );
      }

      console.log(
        `${prefix} ${chalk.white(col.name)} ${chalk.gray(`(${col.dataType})`)}${extra}`,
      );
    }

    if (table.indexes.length > 0) {
      const nonPkIndexes = table.indexes.filter((idx) => !idx.isPrimary);
      for (let i = 0; i < nonPkIndexes.length; i++) {
        const idx = nonPkIndexes[i];
        const isLast = i === nonPkIndexes.length - 1;
        const prefix = isLast ? '  └─' : '  ├─';
        console.log(
          `${prefix} ${chalk.gray('idx:')} ${idx.name} ${chalk.gray(`(${idx.columns.join(', ')})`)}${idx.isUnique ? chalk.blue(' UNIQUE') : ''}`,
        );
      }
    }

    console.log('');
  }
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
