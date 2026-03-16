import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';
import { MigrationPlan } from './types';

export function exportConfig(plan: MigrationPlan, filePath: string): void {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const data = sanitizePlanForExport(plan);

  if (ext === 'yaml' || ext === 'yml') {
    writeFileSync(filePath, yaml.dump(data, { indent: 2, lineWidth: 120 }));
  } else {
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}

export function importConfig(filePath: string): MigrationPlan {
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const ext = filePath.split('.').pop()?.toLowerCase();

  let data: any;
  if (ext === 'yaml' || ext === 'yml') {
    data = yaml.load(content);
  } else {
    data = JSON.parse(content);
  }

  if (!data.version || !data.direction || !data.source || !data.target) {
    throw new Error('Invalid migration config: missing required fields');
  }

  return data as MigrationPlan;
}

function sanitizePlanForExport(plan: MigrationPlan): any {
  return {
    version: plan.version,
    direction: plan.direction,
    source: { type: plan.source.type, database: plan.source.database },
    target: { type: plan.target.type, database: plan.target.database },
    tableMappings: plan.tableMappings,
    documentMappings: plan.documentMappings,
    conflicts: plan.conflicts,
    options: plan.options,
  };
}
