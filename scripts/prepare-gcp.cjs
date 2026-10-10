// Copies only application source/build files; credentials and student data are excluded.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const stage = process.argv[2];
if (!stage || !path.isAbsolute(stage)) throw new Error('Provide an absolute staging path');
function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'src', 'prisma']) {
  copy(path.join(root, 'apps/api', name), path.join(stage, 'api', name));
}
copy(path.join(root, 'apps/api/Dockerfile.gcp'), path.join(stage, 'api/Dockerfile'));
for (const name of ['app.py', 'requirements.txt', 'Dockerfile']) {
  copy(path.join(root, 'services/ai', name), path.join(stage, 'ai', name));
}
if (fs.existsSync(path.join(root, 'apps/web/dist'))) {
  const assets = path.join(root, 'apps/web/dist/assets');
  const scripts = fs.readdirSync(assets).filter(name => name.endsWith('.js')).map(name => fs.readFileSync(path.join(assets, name), 'utf8'));
  if (!scripts.some(code => code.includes('https://project9-api-381809967406.us-central1.run.app/api')) || scripts.some(code => code.includes('http://localhost:3000/api'))) {
    throw new Error('Rebuild the web app with the production VITE_API_URL before staging for GCP');
  }
  copy(path.join(root, 'apps/web/dist'), path.join(stage, 'web/dist'));
  copy(path.join(root, 'apps/web/nginx.gcp.conf'), path.join(stage, 'web/nginx.gcp.conf'));
  copy(path.join(root, 'apps/web/Dockerfile.gcp'), path.join(stage, 'web/Dockerfile'));
}
console.log('Allowlisted application files staged. No credentials or roster files copied.');
