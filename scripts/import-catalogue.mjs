import {readFileSync,statSync} from 'node:fs';
import {Client} from 'pg';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Operational CLI only. No route or credential is added to the teacher application.
import {importCatalogue} from './catalogue-import.mjs';

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [file,approvalId,...flags]=process.argv.slice(2);
  if(!file || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(approvalId||'') || flags.some(f=>f!=='--apply')) {
    console.error('Usage: node scripts/import-catalogue.mjs <manifest.json> <approval-uuid> [--apply]');process.exit(1);
  }
  const connectionString=process.env.CATALOGUE_DATABASE_URL;
  if(!connectionString){console.error('CATALOGUE_DATABASE_URL is required for the dedicated publisher login.');process.exit(1);}
  const client=new Client({connectionString,connectionTimeoutMillis:10000});
  try {
    if(statSync(file).size>20000000)throw Error('Manifest too large');
    const manifest=JSON.parse(readFileSync(file,'utf8'));
    await client.connect();
    console.log(JSON.stringify(await importCatalogue(client,approvalId,manifest,{apply:flags.includes('--apply')})));
  } catch {
    // Do not print database errors, connection URLs or manifest contents.
    console.error('Catalogue import failed. Check the approval, payload, predecessor and database connection. No success was confirmed.');process.exitCode=1;
  } finally {await client.end();}
}
