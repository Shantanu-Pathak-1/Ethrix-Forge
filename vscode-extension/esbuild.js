const esbuild = require("esbuild");

const args = process.argv.slice(2);
const watch = args.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("esbuild: watching for changes...");
  } else {
    await esbuild.build(buildOptions);
    console.log("esbuild: build completed successfully!");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
