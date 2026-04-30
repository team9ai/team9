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
  isNotNull,
  inArray,
  notInArray,
  aliasedTable,
} from 'drizzle-orm';
// Re-export the pg-core `alias` helper so app code does not import directly
// from drizzle-orm/pg-core (respects the @team9/database package boundary).
// `alias` (vs `aliasedTable`) is preserved because its `BuildAliasTable<T, A>`
// return type is required for self-joins (e.g. joining `users` to its own
// alias `ownerUser`); `aliasedTable<T>(): T` collapses select-row inference
// to `never` in that case. See channels.service.ts ownerUser usage.
export { alias } from 'drizzle-orm/pg-core';
export type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
