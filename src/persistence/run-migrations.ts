import * as fs from "fs";
import * as path from "path";
import { getPool, closePool } from "./pg/pg.client";
import { loadConfig } from "../config";

async function runMigrations(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config.database.url);

  const migrationsDir = path.resolve(__dirname, "../../db");
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");
    console.log(`Applying ${file}...`);
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }

  await closePool();
  console.log("All migrations applied.");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
