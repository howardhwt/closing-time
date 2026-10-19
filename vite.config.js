export default { server:{port:5173}, build:{target:'esnext',rollupOptions:{input:{main:'index.html'}}}, worker:{format:'es'}, optimizeDeps:{exclude:['@viggle/splat-engine']}, base:'./' };
