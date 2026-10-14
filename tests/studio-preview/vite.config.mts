import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('../..',import.meta.url));
export default defineConfig({plugins:[{name:'studio-preview-only-actions',enforce:'pre',resolveId(source,importer){if(!importer||!source.startsWith('.'))return;const target=path.resolve(path.dirname(importer),source);if([path.join(root,'app/(accounts)/admin/studio/actions'),path.join(root,'app/(accounts)/admin/studio/draft-actions'),path.join(root,'app/(accounts)/admin/studio/check-actions'),path.join(root,'app/(accounts)/admin/studio/integration-actions'),path.join(root,'app/(accounts)/admin/studio/release-actions'),path.join(root,'app/(accounts)/admin/studio/publication-actions'),path.join(root,'app/(accounts)/actions')].includes(target))return path.join(root,'tests/studio-preview/actions.ts');}},react()],resolve:{alias:{'next/navigation':path.join(root,'tests/studio-preview/navigation.ts')}},define:{'process.env':{}},server:{host:'127.0.0.1',port:3107,strictPort:true,fs:{allow:[root]}}});
