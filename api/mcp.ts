import fs from 'fs';
import path from 'path';
import {createHttpHandler} from '@malloydata/cli/mcp-http';

// /var/task is read-only on Lambda so DuckDB can't write its WAL there.
// Copy the bundled database to /tmp once per cold start.
const src = path.join(process.cwd(), 'data/imdb.duckdb');
const dest = '/tmp/imdb.duckdb';
if (fs.existsSync(src) && !fs.existsSync(dest)) {
  fs.copyFileSync(src, dest);
}

// malloy-config.json (bundled via includeFiles) points to /tmp/imdb.duckdb.
// process.cwd() == /var/task == project root at runtime.
const handle = createHttpHandler();

export default async function (req: any, res: any): Promise<void> {
  await handle(req, res);
}
