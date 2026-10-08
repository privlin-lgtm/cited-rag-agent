import type { Metadata } from 'next';
import './globals.css';

const title = 'cited-rag-agent';
const description = 'Agentic RAG over a cross-border payments corpus, with every citation checked against the stored text.';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: 'website' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">{children}</body>
    </html>
  );
}
