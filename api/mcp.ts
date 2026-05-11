console.log('module loading...');

import {createHttpHandler} from '@malloydata/cli/mcp-http';

console.log('import done, calling createHttpHandler...');
const handle = createHttpHandler();
console.log('handler created');

export default async function (req: any, res: any): Promise<void> {
  console.log('request received:', req.method, req.url);
  await handle(req, res);
  console.log('request done');
}
