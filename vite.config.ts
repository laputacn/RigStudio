import {defineConfig} from 'vite';
export default defineConfig({
 base:'./',
 server:{host:'127.0.0.1',port:5188,strictPort:true},
 build:{target:'es2022',chunkSizeWarningLimit:1400,rolldownOptions:{output:{manualChunks:(id:string)=>id.includes('/three/')?'three':id.includes('/react')?'react':undefined}}}
});
