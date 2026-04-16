// Re-export drizzle-orm types and utilities for use in other packages
export {
  eq,
  ne,
  and,
  or,
  lt,
  lte,
  gt,
  gte,
  sql,
  like,
  desc,
  asc,
  isNull,
  inArray,
  notInArray,
  aliasedTable,
} from 'drizzle-orm';
// Re-export the pg-core `alias` helper so app code does not import directly
// from drizzle-orm/pg-core (respects the @team9/database package boundary).
export { alias } from 'drizzle-orm/pg-core';
export type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
