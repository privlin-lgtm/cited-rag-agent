import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { tool_name: name = '', tool_input: input } = JSON.parse(readFileSync(0, 'utf8'));
const args = input ?? {};
const tool = name.split('__').at(-1);
const guarded = new Set(['main', 'master', 'sandbox', 'qa']);
const never = new Set([
  'enable_pr_auto_merge',
  'create_deployment',
  'deploy_to_vercel',
  'request_promote',
  'request_rollback',
  'assign_alias',
  'start_rolling_release',
  'approve_rolling_release_stage',
  'complete_rolling_release',
]);
const branchWrites = new Set(['push_files', 'create_or_update_file', 'delete_file']);
const branch = String(args.branch ?? '').replace(/^refs\/heads\//, '');

const block = (reason) => {
  console.error(`Blocked: ${reason}`);
  process.exit(2);
};

if (never.has(tool) || (branchWrites.has(tool) && (!branch || guarded.has(branch)))) {
  block(
    `${tool} is Paul's to run. Deploys, promotions and writes to main, master, sandbox or qa go through a PR he merges. Push a named branch instead.`,
  );
}

const checkMerge = () => {
  const number = args.pullNumber;
  const rule = 'An agent merges only a PR into sandbox, with merge_method "merge", after Paul writes "merge <number>" for that PR.';
  if (name !== 'mcp__github__merge_pull_request') block(`merges go only through mcp__github__merge_pull_request. ${rule}`);
  if (args.owner !== 'privlin-lgtm' || args.repo !== 'cited-rag-agent') block(`merges outside privlin-lgtm/cited-rag-agent are Paul's. ${rule}`);
  if (!Number.isInteger(number) || number < 1) block(`pullNumber must be a PR number. ${rule}`);
  if (args.merge_method !== 'merge') block(`only a merge commit is allowed, never squash or rebase. ${rule}`);

  const { status, stdout, error } = spawnSync(
    'gh',
    ['api', `repos/privlin-lgtm/cited-rag-agent/pulls/${number}`, '--jq', '{base: .base.ref, state: .state, draft: .draft, fork: (.head.repo.full_name != .base.repo.full_name), title: .title, head: .head.sha}'],
    { encoding: 'utf8' },
  );
  if (error || status !== 0) block(`could not read PR #${number} with gh api, so its base is unknown. Paul merges it himself.`);
  const pr = JSON.parse(stdout);
  if (typeof pr !== 'object' || pr === null || typeof pr.head !== 'string') block(`gh api gave no PR details for #${number}. Paul merges it himself.`);
  if (pr.base !== 'sandbox') block(`PR #${number} targets ${pr.base}. Only PRs into sandbox can be merged by an agent; promotions are Paul's.`);
  if (pr.state !== 'open') block(`PR #${number} is ${pr.state}, not open.`);
  if (pr.draft) block(`PR #${number} is a draft. Mark it ready for review first.`);
  if (pr.fork) block(`PR #${number} comes from a fork. Paul merges it himself.`);

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `Merge PR #${number} "${pr.title}" at ${pr.head.slice(0, 7)} into sandbox with a merge commit? Approve only if you wrote "merge ${number}" for this PR and it had no newer commits than ${pr.head.slice(0, 7)}.`,
      },
    }),
  );
};

if (tool === 'merge_pull_request') {
  try {
    checkMerge();
  } catch (error) {
    block(`the merge check failed (${error.message}), so nothing was checked. Paul merges it himself.`);
  }
}
