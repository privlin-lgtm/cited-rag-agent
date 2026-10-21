import { header, checkedCount, markers, type RunState } from '../lib/run-state';
import { Badge } from './ui/badge';
import { Prose } from './prose';

export const AnswerPanel = ({ run, running, problem }: { run: RunState; running: boolean; problem?: string }) => {
  const { citations, error, pending } = run;
  return (
    <section aria-label="Answer" aria-live="polite">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Answer</h2>
      {problem && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{problem}</p>}
      {citations?.status === 'declined' && <p className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">Claude declined to answer this question.</p>}
      {citations && citations.status !== 'declined' && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant={citations.results.length === 0 ? 'default' : checkedCount(citations) > 0 ? 'license' : 'danger'}>{header(citations)}</Badge>
            {citations.status === 'cut_off' && <Badge variant="restricted">cut off</Badge>}
          </div>
          {citations.results.length > 0 && checkedCount(citations) === 0 && (
            <p className="mb-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              This answer has no checked citation. Treat it as unverified.
            </p>
          )}
          <Prose
            className="text-[15px] leading-relaxed"
            pieces={citations.segments.flatMap((segment, i) => [
              segment.text,
              ...markers(citations, segment.refs).map((marker, j) =>
                marker.kind === 'checked' ? (
                  <a key={`${i}-${j}`} href={`#excerpt-${marker.n}`} className="mx-0.5 align-super text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                    [{marker.n}]
                  </a>
                ) : (
                  <Badge key={`${i}-${j}`} variant="danger" className="mx-0.5" title={`The check failed: ${marker.reason}`}>
                    unchecked
                  </Badge>
                ),
              ),
            ])}
          />
        </div>
      )}
      {!citations && error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">No answer generated.</p>
          <p className="mt-1 break-words">{error.message}</p>
          {error.excerpts.length > 0 && <p className="mt-1">The passages retrieved so far are shown beside this.</p>}
        </div>
      )}
      {!citations && !error && !problem && pending && <Prose className="text-[15px] leading-relaxed text-zinc-500" pieces={[pending]} />}
      {!citations && !error && !problem && !pending && running && run.steps.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" aria-hidden />
          Reading the passages and writing the answer…
        </p>
      )}
      {!citations && !error && !problem && !pending && !running && <p className="text-sm text-zinc-500">Ask a question to see the answer and its checked citations.</p>}
    </section>
  );
};
