import fs from 'fs';

export default function(req: any, res: any) {
  const files = fs.readdirSync('/var/task').filter(f => !f.startsWith('node_'));
  res.end(JSON.stringify(files.sort(), null, 2));
}
