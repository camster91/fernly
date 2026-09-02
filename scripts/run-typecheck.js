const { execSync } = require('child_process');
const fs = require('fs');
const out = 'C:\\Users\\camst\\Projects\\fernly\\scripts\\.typecheck.out';
try {
  const r = execSync('npx tsc --noEmit', { cwd: 'C:\\Users\\camst\\Projects\\fernly', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(out, r || '(no output)');
} catch (e) {
  fs.writeFileSync(out, (e.stdout || '') + '\n--- stderr ---\n' + (e.stderr || ''));
  process.exit(1);
}
