import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export function loadOntologyEnvFiles(): void {
  const root = process.cwd();
  for (const file of ['.env', '.env.local', '.env.harvest.local', '.env.foundry.local']) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    dotenv.config({ path: full, override: false });
  }
}
