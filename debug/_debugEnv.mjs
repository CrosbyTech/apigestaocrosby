import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

let loaded = false;

export function loadDebugEnv() {
  if (loaded) {
    return;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const backendEnvPath = path.resolve(currentDir, '../.env');

  dotenv.config({ path: backendEnvPath });
  loaded = true;
}