// Shared transactional delivery; the CLI entry point is import-catalogue.mjs.
export async function importCatalogue(client,approvalId,manifest,{apply=false}={}) {
  await client.query('begin');
  try {
    await client.query("set local statement_timeout='30s'");
    await client.query("set local lock_timeout='10s'");
    const {rows}=await client.query('select public.import_catalogue_release($1,$2::jsonb) as result',[approvalId,JSON.stringify(manifest)]);
    await client.query(apply?'commit':'rollback');
    return {mode:apply?'applied':'dry-run',...rows[0].result};
  } catch(error) {
    await client.query('rollback');
    throw error;
  }
}
