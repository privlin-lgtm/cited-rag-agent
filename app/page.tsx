import { appEnv } from '../lib/env';

export const dynamic = 'force-dynamic';

const chain = 'https://github.com/privlin-lgtm/cited-rag-agent/blob/master/intent/2026-10-07-mvp';
const links = [
  ['Intent', 'intent.md'],
  ['Spec', 'spec.md'],
  ['Plan', 'plan.md'],
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <span className="w-fit rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium uppercase tracking-wide dark:border-zinc-700">
        {appEnv.parse(process.env.APP_ENV)}
      </span>
      <h1 className="text-3xl font-semibold">cited-rag-agent</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Agentic RAG over a cross-border payments corpus, with every citation checked against the text it came from.
      </p>
      <ul className="flex gap-6">
        {links.map(([label, file]) => (
          <li key={file}>
            <a className="underline underline-offset-4" href={`${chain}/${file}`}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
