import { readFileSync } from 'node:fs';

const { tool_input: input = {} } = JSON.parse(readFileSync(0, 'utf8'));
const file = (input.file_path ?? '').replaceAll('\\', '/');

if (/\.(ts|tsx|js|mjs|sql)$/i.test(file) && !file.includes('/.claude/hooks/')) {
  const added = [input.content, input.new_string, ...(input.edits ?? []).map((edit) => edit.new_string)].filter(Boolean).join('\n');
  const hit = added.match(/(?:\/\/|\/\*|--|^\s*\*)\s*(?:TODO|FIXME)\b/m) ?? added.match(/not implemented|implement (?:this )?later/i);
  if (hit) {
    console.error(`${file}: added text contains "${hit[0].trim()}". Finish the implementation instead of leaving a placeholder.`);
    process.exit(2);
  }
}
