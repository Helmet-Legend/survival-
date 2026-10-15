export { prepareDatabase } from './connection';
export {
  searchGuides,
  syncGuides,
  toFtsQuery,
  type BundledGuide,
  type GuideSearchHit,
  type GuideSyncReport,
} from './guides';
export {
  getSchemaVersion,
  migrate,
  MigrationError,
  type MigrationErrorCode,
  type MigrationReport,
} from './migrate';
export { MIGRATIONS, SCHEMA_VERSION, type Migration } from './schema';
export type { SqlDatabase, SqlResult, SqlRow, SqlValue } from './types';
