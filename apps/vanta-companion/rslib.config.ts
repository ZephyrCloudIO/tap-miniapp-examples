import { defineConfig } from "@rslib/core";
import { tapLib } from "@theaiplatform/miniapp-sdk/rspack";
const library=tapLib({manifest:"./manifest.tap.json",packageTarget:"desktop",packageOutputRoot:".tap-build/desktop",federation:{name:"tap_vanta_companion_desktop",filename:"remoteEntry.mjs",manifest:true,library:{type:"module"},dts:false,exposes:{"./tap/lifecycle":"./src/lifecycle.ts","./ui/desktop":"./src/surface.tsx"}}});
library.output={...library.output,assetPrefix:"auto",sourceMap:false,minify:true};
export default defineConfig({lib:[library]});
