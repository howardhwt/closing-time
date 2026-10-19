import { existsSync } from 'fs';
const input = { main: 'index.html' };
if (existsSync('preview.html')) input.preview = 'preview.html'; // local-only motion approval page, gitignored
export default { server:{port:5173}, build:{target:'esnext',rollupOptions:{input}}, worker:{format:'es'}, optimizeDeps:{exclude:['@viggle/splat-engine']}, base:'./' };
