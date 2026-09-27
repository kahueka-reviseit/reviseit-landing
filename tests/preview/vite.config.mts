import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// PREVIEW_PORT lets parallel worktrees run their own synthetic preview (default 3103).
const port=Number(process.env.PREVIEW_PORT||3103);
// Next's navigation helpers read process.env; the isolated preview supplies an empty one.
export default defineConfig({plugins:[react()],define:{'process.env':{}},server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}}});
