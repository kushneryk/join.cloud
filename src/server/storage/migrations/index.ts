import type { Database } from "sql.js";

export interface Migration {
  name: string;
  up: (db: Database) => void;
}

import { up as up001 } from "./001_initial_schema.js";
import { up as up002 } from "./002_add_room_description_and_type.js";
import { up as up003 } from "./003_add_agent_role.js";

const migrations: Migration[] = [
  { name: "001_initial_schema", up: up001 },
  { name: "002_add_room_description_and_type", up: up002 },
  { name: "003_add_agent_role", up: up003 },
];

export function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const stmt = db.prepare("SELECT name FROM migrations");
  const applied = new Set<string>();
  while (stmt.step()) {
    applied.add(stmt.getAsObject().name as string);
  }
  stmt.free();

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    migration.up(db);
    db.run("INSERT INTO migrations (name) VALUES (?)", [migration.name]);
  }
}
