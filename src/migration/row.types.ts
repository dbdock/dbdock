import type { ObjectId } from 'mongodb';

export type PostgresRow = Record<string, unknown>;

export type MongoDocument = Record<string, unknown> & { _id?: ObjectId };

export interface MongoIndexInfo {
  name?: string;
  key?: Record<string, number>;
  unique?: boolean;
  sparse?: boolean;
  [k: string]: unknown;
}
