// Minimal test — no Malloy, just prove the function runtime works
export default async function (req: any, res: any): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ok: true, method: req.method, url: req.url}));
}
