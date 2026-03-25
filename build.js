const esbuild = require('esbuild');
const fs = require('fs');

// Clean old hashed bundles from dist/
if (fs.existsSync('dist')) {
    fs.readdirSync('dist')
        .filter(f => /^bundle-[A-Z0-9]+\.js$/.test(f))
        .forEach(f => fs.unlinkSync(`dist/${f}`));
}

esbuild.build({
    entryPoints: { bundle: 'src/Game.ts' },
    bundle: true,
    outdir: 'dist',
    entryNames: '[name]-[hash]',
    metafile: true,
}).then(result => {
    const outputPath = Object.keys(result.metafile.outputs)[0]; // e.g. "dist/bundle-A1B2C3D4.js"

    let html = fs.readFileSync('index.html', 'utf8');
    html = html.replace(/src="dist\/[^"]+\.js"/, `src="${outputPath}"`);
    fs.writeFileSync('index.html', html);

    console.log(`Built: ${outputPath}`);
}).catch(() => process.exit(1));
