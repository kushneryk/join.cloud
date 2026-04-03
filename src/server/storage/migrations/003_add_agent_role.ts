import type { Database } from "sql.js";

export function up(db: Database): void {
  db.run("ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
}
