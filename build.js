const esbuild = require('esbuild');
const fs = require('fs');

// Each entry point and the page that loads it. The page's script tag is
// rewritten to the hashed filename after every build.
const ENTRIES = {
    bundle: { entry: 'src/Game.ts', page: 'index.html' },
};

// Clean old hashed bundles from dist/
if (fs.existsSync('dist')) {
    const names = Object.keys(ENTRIES).join('|');
    const stale = new RegExp(`^(${names})-[A-Z0-9]+\\.js$`);
    fs.readdirSync('dist')
        .filter(f => stale.test(f))
        .forEach(f => fs.unlinkSync(`dist/${f}`));
}

// Inject a build timestamp so the content hash always changes, busting caches
const buildStamp = `// built: ${Date.now()}\n`;

const entryPoints = Object.fromEntries(
    Object.entries(ENTRIES).map(([name, { entry }]) => [name, entry])
);

esbuild.build({
    entryPoints,
    bundle: true,
    outdir: 'dist',
    entryNames: '[name]-[hash]',
    metafile: true,
    banner: { js: buildStamp },
}).then(result => {
    for (const [outputPath, output] of Object.entries(result.metafile.outputs)) {
        // Map each output back to the page that should load it, by the entry it
        // was built from — output order is not something to rely on.
        const match = Object.entries(ENTRIES)
            .find(([, { entry }]) => output.entryPoint === entry);
        if (match === undefined) continue;
        const [, { page }] = match;

        let html = fs.readFileSync(page, 'utf8');
        html = html.replace(/src="dist\/[^"]+\.js"/, `src="${outputPath}"`);
        fs.writeFileSync(page, html);

        console.log(`Built: ${outputPath} -> ${page}`);
    }
}).catch(() => process.exit(1));
