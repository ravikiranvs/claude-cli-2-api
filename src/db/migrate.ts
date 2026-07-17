import { openDatabase } from "./connection.js";

export function migrate(databasePath: string): void {
  openDatabase(databasePath).close();
}
