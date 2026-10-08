import type { StepEvent } from '../lib/agent/loop';

const label = (step: StepEvent) => {
  const input = step.input as { query?: string; terms?: string; chunk_id?: string; before?: number; after?: number; document_ids?: string[] };
  switch (step.tool) {
    case 'search_documents':
      return input.query ?? '';
    case 'keyword_search':
      return input.terms ?? '';
    case 'read_neighbours':
      return `chunk ${input.chunk_id ?? ''} (${input.before ?? 1} before, ${input.after ?? 1} after)`;
    default:
      return '';
  }
};

const scoreLabel = (step: StepEvent) => (step.fallback || step.tool === 'keyword_search' ? 'keyword rank' : step.tool === 'search_documents' ? 'similarity' : '');

const MAX_HITS = 5;

export const Timeline = ({ steps, running }: { steps: StepEvent[]; running: boolean }) => (
  <section aria-label="What the agent did" aria-live="polite">
    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Steps</h2>
    {steps.length === 0 && !running && <p className="text-sm text-zinc-500">Searches appear here as they happen.</p>}
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">round {step.round}</span>
            <span className="font-mono text-xs font-medium">{step.tool}</span>
            {label(step) && <span className="min-w-0 break-words text-zinc-700 dark:text-zinc-300">{label(step)}</span>}
          </div>
          {step.reason && <p className="mt-1 italic text-zinc-600 dark:text-zinc-400">{step.reason}</p>}
          {step.fallback && (
            <p className="mt-1 text-amber-700 dark:text-amber-400" title={step.fallbackReason?.slice(0, 200)}>
              keyword fallback (embeddings unavailable)
            </p>
          )}
          {step.error && <p className="mt-1 text-red-700 dark:text-red-400">{step.error}</p>}
          {step.hits.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              {step.hits.slice(0, MAX_HITS).map((hit, j) => (
                <li key={j} className="break-words">
                  {hit.file} · {hit.locator}
                  {hit.score !== null && (
                    <span className="ml-1 text-zinc-400">
                      {scoreLabel(step)} {hit.score.toFixed(3)}
                    </span>
                  )}
                </li>
              ))}
              {step.hits.length > MAX_HITS && <li>+{step.hits.length - MAX_HITS} more</li>}
            </ul>
          )}
          {!step.error && step.hits.length === 0 && step.tool !== 'list_documents' && <p className="mt-1 text-xs text-zinc-500">No matching passages.</p>}
        </li>
      ))}
    </ol>
    {running && (
      <p className="mt-3 flex items-center gap-2 text-sm text-zinc-500">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" aria-hidden />
        Working…
      </p>
    )}
  </section>
);
