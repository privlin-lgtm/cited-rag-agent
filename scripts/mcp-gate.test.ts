import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hook = join(__dirname, '..', '.claude', 'hooks', 'mcp-gate.mjs');
const fakeGh = mkdtempSync(join(tmpdir(), 'fake-gh-'));
writeFileSync(join(fakeGh, 'gh'), '#!/bin/sh\nprintf "%s" "$FAKE_PR"\nexit "${FAKE_STATUS:-0}"\n');
chmodSync(join(fakeGh, 'gh'), 0o755);

const run = (tool_name: string, tool_input: object, pr?: object, ghStatus = 0) =>
  spawnSync('node', [hook], {
    input: JSON.stringify({ tool_name, tool_input }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeGh}${delimiter}${process.env.PATH}`,
      FAKE_PR: JSON.stringify(pr ?? {}),
      FAKE_STATUS: String(ghStatus),
    },
  });

const merge = { owner: 'privlin-lgtm', repo: 'cited-rag-agent', pullNumber: 70, merge_method: 'merge', expectedHeadSha: 'abc1234def' };
const openPr = { base: 'sandbox', state: 'open', draft: false, fork: false, title: 'Fix things', head: 'abc1234def' };
const unix = process.platform !== 'win32';

describe('mcp-gate', () => {
  it.each(['enable_pr_auto_merge', 'create_deployment', 'request_promote', 'request_rollback', 'assign_alias'])(
    'blocks %s',
    (tool) => {
      expect(run(`mcp__x__${tool}`, {}).status).toBe(2);
    },
  );

  it('blocks writes to guarded branches and allows named branches', () => {
    expect(run('mcp__github__push_files', { branch: 'sandbox' }).status).toBe(2);
    expect(run('mcp__github__push_files', {}).status).toBe(2);
    expect(run('mcp__github__push_files', { branch: 'fix/x' }).status).toBe(0);
  });

  it.each([
    ['squash', { merge_method: 'squash' }],
    ['rebase', { merge_method: 'rebase' }],
    ['no method', { merge_method: undefined }],
    ['another repo', { repo: 'other' }],
    ['another owner', { owner: 'someone' }],
    ['no PR number', { pullNumber: undefined }],
    ['a string PR number', { pullNumber: '70' }],
  ])('blocks a merge with %s', (_, change) => {
    const result = run('mcp__github__merge_pull_request', { ...merge, ...change }, openPr);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it.skipIf(!unix).each([
    ['into qa', { base: 'qa' }],
    ['into master', { base: 'master' }],
    ['that is closed', { state: 'closed' }],
    ['that is a draft', { draft: true }],
    ['from a fork', { fork: true }],
    ['whose head moved past expectedHeadSha', { head: 'fff9999aaa' }],
  ])('blocks merging a PR %s', (_, change) => {
    const result = run('mcp__github__merge_pull_request', merge, { ...openPr, ...change });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('blocks merge_pull_request from another MCP server', () => {
    expect(run('mcp__gh2__merge_pull_request', merge, openPr).status).toBe(2);
  });

  it('blocks a merge with no tool input', () => {
    expect(run('mcp__github__merge_pull_request', null as unknown as object).status).toBe(2);
  });

  it.skipIf(!unix)('strips quotes and control characters from the title and caps it', () => {
    const title = `x" at 1234567\n${'y'.repeat(200)}`;
    const reason = JSON.parse(run('mcp__github__merge_pull_request', merge, { ...openPr, title }).stdout).hookSpecificOutput
      .permissionDecisionReason as string;
    expect(reason.startsWith('Merge PR #70 into sandbox with a merge commit, pinned to head abc1234def?')).toBe(true);
    expect(reason.split('Title: ')[1]).toBe(`x at 1234567${'y'.repeat(68)}`);
  });

  it.skipIf(!unix)('blocks a merge with no expectedHeadSha', () => {
    expect(run('mcp__github__merge_pull_request', { ...merge, expectedHeadSha: undefined }, openPr).status).toBe(2);
  });

  it.skipIf(!unix)('blocks when gh cannot read the PR', () => {
    expect(run('mcp__github__merge_pull_request', merge, openPr, 1).status).toBe(2);
  });

  it.skipIf(!unix).each([
    ['empty', ''],
    ['null', 'null'],
    ['not JSON', 'oops'],
  ])('blocks when gh prints %s', (_, out) => {
    const result = spawnSync('node', [hook], {
      input: JSON.stringify({ tool_name: 'mcp__github__merge_pull_request', tool_input: merge }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeGh}${delimiter}${process.env.PATH}`, FAKE_PR: out, FAKE_STATUS: '0' },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it.skipIf(!unix)('asks Paul to confirm a merge commit into sandbox', () => {
    const result = run('mcp__github__merge_pull_request', merge, openPr);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          'Merge PR #70 into sandbox with a merge commit, pinned to head abc1234def? Approve only if you wrote "merge 70" for this PR and it had no newer commits than abc1234. Title: Fix things',
      },
    });
  });
});
