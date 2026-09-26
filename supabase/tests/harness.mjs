// Runs the migrations in PGlite (Postgres compiled to WebAssembly, no
// server) with just enough of Supabase stubbed around them: an auth.users
// table, auth.uid() read from request.jwt.claim.sub (like PostgREST sets
// it), the anon / authenticated / service_role roles and the realtime
// publication. Lets `npm run test:db` check RLS, grants and RPCs locally,
// since there is no CLI access to the real project.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const SUPABASE_STUBS = `
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create publication supabase_realtime;
`

export const migrationFiles = () => fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()

export const readMigration = (file) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')

/** A fresh database with every migration up to `upTo` (e.g. '0012') applied, the last one twice. */
export async function freshDb(upTo) {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  const files = migrationFiles().filter((f) => f.slice(0, 4) <= upTo)
  for (const file of files) await db.exec(readMigration(file))
  // Every migration claims to be safe to run twice
  await db.exec(readMigration(files.at(-1)))
  return db
}

/** Query helpers bound to a database. */
export function helpers(db) {
  const q = async (sql, params) => (await db.query(sql, params)).rows
  return {
    q,
    /** Runs the following queries as that user (authenticated), or as anon with no user. */
    as: (userId) =>
      db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false); set role ${userId ? 'authenticated' : 'anon'};`),
    asAdmin: () => db.exec('reset role;'),
    /** The error message a query raises, '' if it succeeds. */
    errorOf: async (sql, params) => {
      try {
        await q(sql, params)
        return ''
      } catch (err) {
        return err.message
      }
    },
  }
}

/** Creates users (the 0004 trigger gives them a profile); returns their ids. */
export async function addUsers(db, ...names) {
  const ids = names.map((_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
  for (const [i, name] of names.entries()) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [ids[i], `${name}@example.test`, { username: name }])
  }
  return ids
}
