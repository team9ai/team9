#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const journalPath = path.join(
  process.cwd(),
  'apps/server/libs/database/migrations/meta/_journal.json',
);
const migrationsDir = path.dirname(path.dirname(journalPath));

const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
const entries = journal.entries ?? [];
const errors = [];
const seenIdx = new Set();
const seenTags = new Set();
const seenWhen = new Set();

for (let i = 0; i < entries.length; i += 1) {
  const entry = entries[i];
  const label = `${entry.idx}:${entry.tag}`;

  if (entry.idx !== i) {
    errors.push(`${label} has idx=${entry.idx}, expected ${i}`);
  }

  if (seenIdx.has(entry.idx)) {
    errors.push(`${label} duplicates idx ${entry.idx}`);
  }
  seenIdx.add(entry.idx);

  if (seenTags.has(entry.tag)) {
    errors.push(`${label} duplicates tag ${entry.tag}`);
  }
  seenTags.add(entry.tag);

  if (seenWhen.has(entry.when)) {
    errors.push(`${label} duplicates when ${entry.when}`);
  }
  seenWhen.add(entry.when);

  if (i > 0 && entry.when <= entries[i - 1].when) {
    errors.push(
      `${label} has when=${entry.when}, not greater than previous ${entries[i - 1].idx}:${entries[i - 1].tag} when=${entries[i - 1].when}`,
    );
  }

  const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    errors.push(`${label} is missing SQL file ${path.relative(process.cwd(), sqlPath)}`);
  }
}

if (errors.length > 0) {
  console.error('Drizzle migration journal order check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Drizzle migration journal order check passed (${entries.length} migrations).`);
