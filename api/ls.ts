import fs from 'fs';
import path from 'path';

function walk(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  try {
    return fs.readdirSync(dir).flatMap(f => {
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) return [`${full}/`, ...walk(full, depth + 1)];
        return [full];
      } catch { return []; }
    });
  } catch { return []; }
}

export default function(req: any, res: any) {
  res.end(JSON.stringify(walk('/var/task').filter(f => !f.includes('node_modules')), null, 2));
}
