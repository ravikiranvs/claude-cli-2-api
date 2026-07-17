import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase } from "./schema.js";

export function openDatabase(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  migrateDatabase(db);
  return db;
}
