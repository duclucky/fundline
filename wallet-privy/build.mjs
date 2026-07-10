// Bundle the React wallet island into one self-contained IIFE served as a static file by the app.
// Run: npm install && npm run build  (from this wallet-privy/ folder). Output: ../wallet-privy.bundle.js
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  loader: { ".js": "jsx" },
  outfile: "../wallet-privy.bundle.js",
  logLevel: "info",
});

console.log("Built ../wallet-privy.bundle.js");
