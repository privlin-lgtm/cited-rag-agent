import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { cwd, tool_input: input = {} } = JSON.parse(readFileSync(0, 'utf8'));
const raw = input.command ?? '';
const quoted = [];
const command = raw.replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g, (_, __, body) => `"${quoted.push(body) - 1}"`);
const unquote = (text) => text.replace(/"(\d+)"/g, (_, index) => quoted[index]);
const guarded = new Set(['main', 'master', 'sandbox', 'qa']);
const vercel = '(?<![\\w-])(?:vercel|vc)(?![\\w-])';

const onGuardedBranch = () => {
  const { status, stdout } = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
  return status !== 0 || guarded.has(stdout.trim());
};

const pushesToGuarded = (segment) => {
  const [, rest] = segment.match(/\bgit(?:\s+-\S+(?:\s+\S+)?)*?\s+push\b(.*)$/) ?? [];
  if (rest === undefined) return false;
  const [, ...refspecs] = rest.split(/\s+/).map(unquote).filter((arg) => arg && !arg.startsWith('-'));
  const targets = refspecs.length
    ? refspecs.map((spec) => spec.replace(/^\+/, '').split(':').at(-1).replace(/^refs\/heads\//, ''))
    : ['HEAD'];
  return targets.some((target) => (target === 'HEAD' ? onGuardedBranch() : guarded.has(target)));
};

const blocked = [
  /\bgh\s+pr\s+merge\b/i,
  new RegExp(`${vercel}.*\\s--prod\\b`, 'i'),
  new RegExp(`${vercel}.*\\s--target[=\\s]+production\\b`, 'i'),
  new RegExp(`${vercel}\\s+(?:promote|rollback|alias)\\b`, 'i'),
];

const readsEnvFile = /(?<![\w.-])\.env(?![\w-])(?!\.example\b)/.test(raw.replace(/--env-file-if-exists=\S+|\bcp\s+\.env\.example\s+\.env\.local\b/g, ''));

if (readsEnvFile) {
  console.error('Blocked: .env, .env.local and .env.*.local are never read. Scripts load them with --env-file-if-exists.');
  process.exit(2);
}

if (
  /\bVERCEL_ENV\s*=\s*["']?production\b/i.test(raw) ||
  /\bgh\s+api\b.*(?:\/pulls\/\d+\/[\w/]*merge\b|\/merges\b|\bgraphql\b.*merge|git\/refs\/heads\/(?:main|master|sandbox|qa)\b|\bbranch=(?:main|master|sandbox|qa)\b)/is.test(raw) ||
  (/\bgh\s+api\b.*\/contents\//s.test(raw) &&
    /\s(?:-X|--method)[=\s]*(?:PUT|DELETE|POST|PATCH)\b|\s-[fF]\s|\s--(?:raw-)?field[=\s]|\s--input[=\s]/i.test(raw) &&
    !/\bbranch=(?!(?:main|master|sandbox|qa)\b)[\w./-]+/.test(raw)) ||
  blocked.some((pattern) => pattern.test(command)) ||
  command.split(/&&|\|\||[;|\n]/).some(pushesToGuarded)
) {
  console.error(
    'Blocked: pushes to main, master, sandbox or qa, merges and production deploys are Paul\'s to run. Push a named branch with git push -u origin <branch> and open a PR instead.',
  );
  process.exit(2);
}
