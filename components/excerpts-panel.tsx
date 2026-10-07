import type { Excerpt } from '../lib/agent/citations';
import { Badge } from './ui/badge';

export const ExcerptsPanel = ({ excerpts, noAnswer }: { excerpts: Excerpt[]; noAnswer: boolean }) => (
  <section aria-label="Excerpts">
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">{noAnswer ? 'Retrieved passages (no answer generated)' : 'Excerpts'}</h2>
    {excerpts.length === 0 && <p className="text-sm text-zinc-500">The passages behind each checked citation appear here, with the cited sentences highlighted.</p>}
    <div className="space-y-4">
      {excerpts.map((excerpt) => (
        <article key={excerpt.chunkId} id={`excerpt-${excerpt.n}`} className="scroll-mt-4 rounded-lg border border-zinc-200 p-3 text-sm target:border-indigo-500 target:ring-2 target:ring-indigo-500/30 dark:border-zinc-800">
          <header className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>{excerpt.n}</Badge>
            <span className="min-w-0 break-words font-medium">{excerpt.file}</span>
            <span className="text-zinc-500">{excerpt.locator}</span>
            {excerpt.sourceUrl && (
              <a className="ml-auto text-xs text-indigo-700 underline underline-offset-2 dark:text-indigo-300" href={excerpt.sourceUrl} target="_blank" rel="noopener noreferrer">
                Open source
              </a>
            )}
          </header>
          <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">
            {excerpt.blocks.map((block, i) =>
              block.cited ? (
                <mark key={i} className="rounded bg-yellow-200 px-0.5 text-zinc-900 dark:bg-yellow-500/40 dark:text-zinc-50">
                  {block.text}{' '}
                </mark>
              ) : (
                <span key={i}>{block.text} </span>
              ),
            )}
          </p>
        </article>
      ))}
    </div>
  </section>
);
