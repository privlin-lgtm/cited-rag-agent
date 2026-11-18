import { readFileSync } from 'node:fs';

const { tool_name: name = '', tool_input: input = {} } = JSON.parse(readFileSync(0, 'utf8'));
const tool = name.split('__').at(-1);
const guarded = new Set(['main', 'master', 'sandbox', 'qa']);
const never = new Set([
  'merge_pull_request',
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
const branch = String(input.branch ?? '').replace(/^refs\/heads\//, '');

if (never.has(tool) || (branchWrites.has(tool) && (!branch || guarded.has(branch)))) {
  console.error(
    `Blocked: ${tool} is Paul's to run. Merges, deploys, promotions and writes to main, master, sandbox or qa go through a PR he merges. Push a named branch instead.`,
  );
  process.exit(2);
}
