import {readFileSync,readdirSync} from 'node:fs';
export async function applyD1Schema(db, files = readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()) {
  for(const file of files) {
    const statements=readFileSync('drizzle/'+file,'utf8').split(';').map(s=>s.trim()).filter(Boolean);
    await db.batch(statements.map(sql=>db.prepare(sql)));
  }
}
