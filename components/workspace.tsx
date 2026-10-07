'use client';

import { useState } from 'react';
import type { DocumentView } from '../lib/documents';
import { initialRun, reduce, type DoneEvent, type RunState, type WireEvent } from '../lib/run-state';
import { AnswerPanel } from './answer-panel';
import { DocumentsPanel } from './documents-panel';
import { ExcerptsPanel } from './excerpts-panel';
import { Timeline } from './timeline';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const MAX_QUESTION = 500;
const CHAIN = 'https://github.com/privlin-lgtm/cited-rag-agent/blob/master/intent/2026-10-07-mvp';

const apiError = async (response: Response) => ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `The request failed (HTTP ${response.status}).`;

export function Workspace({ env, examples, initialDocuments }: { env: string; examples: string[]; initialDocuments: DocumentView[] }) {
  const [documents, setDocuments] = useState<DocumentView[]>(initialDocuments);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialDocuments.map(({ id }) => id)));
  const [question, setQuestion] = useState('');
  const [run, setRun] = useState<RunState>(initialRun);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [lastDone, setLastDone] = useState<DoneEvent>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();

  const load = async () => {
    const response = await fetch('/api/documents');
    if (!response.ok) return setUploadError(await apiError(response));
    const { documents: loaded } = (await response.json()) as { documents: DocumentView[] };
    setDocuments(loaded);
    setSelected((current) => new Set(loaded.filter(({ id, origin }) => origin === 'upload' || current.has(id)).map(({ id }) => id)));
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || running || selected.size === 0) return;
    setRunning(true);
    setRun(initialRun);
    setProblem(undefined);
    try {
      const everything = selected.size === documents.length;
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed, documentIds: everything ? undefined : [...selected] }),
      });
      if (!response.ok || !response.body) return setProblem(await apiError(response));
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines)
          if (line.trim()) {
            const event = JSON.parse(line) as WireEvent;
            setRun((state) => reduce(state, event));
            if (event.type === 'done') setLastDone(event);
          }
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The connection was lost.');
    } finally {
      setRunning(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(undefined);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/upload', { method: 'POST', body: form });
      if (!response.ok) return setUploadError(await apiError(response));
      await load();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'The upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    setUploadError(undefined);
    const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (!response.ok) return setUploadError(await apiError(response));
    setSelected((current) => new Set([...current].filter((other) => other !== id)));
    await load();
  };

  const excerpts = run.citations?.excerpts ?? run.error?.excerpts ?? [];

  return (
    <div className="mx-auto flex min-h-screen max-w-[100rem] flex-col px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">cited-rag-agent</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Agentic RAG over cross-border payments documents. Every citation is checked against the text it came from.</p>
        </div>
        <Badge className="uppercase tracking-wide" title="Environment">
          {env}
        </Badge>
      </header>

      <main className="grid flex-1 gap-8 lg:grid-cols-[17rem_minmax(0,1fr)_22rem]">
        <div className="order-3 lg:order-1">
          <DocumentsPanel
            documents={documents}
            selected={selected}
            onToggle={(id) =>
              setSelected((current) => {
                const next = new Set(current);
                if (!next.delete(id)) next.add(id);
                return next;
              })
            }
            onToggleAll={() => setSelected(selected.size < documents.length ? new Set(documents.map(({ id }) => id)) : new Set())}
            onUpload={upload}
            onDelete={remove}
            uploading={uploading}
            uploadError={uploadError}
          />
        </div>

        <div className="order-1 min-w-0 space-y-6 lg:order-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor="question" className="sr-only">
              Your question
            </label>
            <textarea
              id="question"
              value={question}
              maxLength={MAX_QUESTION}
              rows={2}
              placeholder="Ask about remittance rules, PSD2 or Mojaloop…"
              className="w-full resize-y rounded-lg border border-zinc-300 bg-transparent p-3 text-[15px] focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-700"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={running || !question.trim() || selected.size === 0}>
                {running ? 'Working…' : 'Ask'}
              </Button>
              <span className="text-xs text-zinc-500">
                {selected.size === 0 ? 'Select at least one document.' : `${selected.size} document${selected.size === 1 ? '' : 's'} in scope`} · {question.length}/{MAX_QUESTION}
              </span>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Example questions">
              {examples.map((example) => (
                <li key={example}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto whitespace-normal py-1.5 text-left"
                    disabled={running}
                    onClick={() => {
                      setQuestion(example);
                      void ask(example);
                    }}
                  >
                    {example}
                  </Button>
                </li>
              ))}
            </ul>
          </form>
          <Timeline steps={run.steps} running={running} />
          <AnswerPanel run={run} running={running} problem={problem} />
        </div>

        <div className="order-2 lg:order-3">
          <ExcerptsPanel excerpts={excerpts} noAnswer={!run.citations && Boolean(run.error)} />
        </div>
      </main>

      <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
        {lastDone ? (
          <p>
            Last answer: {lastDone.model} · {lastDone.inputTokens.toLocaleString('en-US')} in / {lastDone.outputTokens.toLocaleString('en-US')} out · cache {lastDone.cacheReadTokens.toLocaleString('en-US')} read /{' '}
            {lastDone.cacheWriteTokens.toLocaleString('en-US')} write · ${lastDone.costUsd.toFixed(4)} · {(lastDone.latencyMs / 1000).toFixed(1)} s
          </p>
        ) : (
          <p>No question asked yet.</p>
        )}
        <p className="mt-1 space-x-4">
          {[
            ['Intent', 'intent.md'],
            ['Spec', 'spec.md'],
            ['Plan', 'plan.md'],
          ].map(([label, file]) => (
            <a key={file} className="underline underline-offset-4" href={`${CHAIN}/${file}`}>
              {label}
            </a>
          ))}
        </p>
      </footer>
    </div>
  );
}
