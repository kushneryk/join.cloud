import type { Database } from "sql.js";

export function up(db: Database): void {
  db.run("ALTER TABLE rooms ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  db.run("ALTER TABLE rooms ADD COLUMN type TEXT NOT NULL DEFAULT 'group'");
}
