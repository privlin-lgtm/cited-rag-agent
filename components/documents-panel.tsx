import type { DocumentView } from '../lib/documents';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const licenceLabel = (licence: string) => (licence.startsWith('Public domain') ? 'Public domain' : licence.startsWith('Reuse authorised') ? 'EU reuse' : licence);

export const DocumentsPanel = ({
  documents,
  selected,
  onToggle,
  onToggleAll,
  onUpload,
  onDelete,
  uploading,
  uploadError,
}: {
  documents: DocumentView[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  uploading: boolean;
  uploadError?: string;
}) => {
  const corpus = documents.filter(({ origin }) => origin === 'corpus');
  const uploads = documents.filter(({ origin }) => origin === 'upload');
  const item = (document: DocumentView) => (
    <li key={document.id} className="rounded-lg border border-zinc-200 p-2.5 text-sm dark:border-zinc-800">
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-600" checked={selected.has(document.id)} onChange={() => onToggle(document.id)} />
        <span className="min-w-0 flex-1 break-words font-medium leading-snug">{document.title}</span>
        {document.origin === 'upload' && (
          <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${document.filename}`} onClick={() => onDelete(document.id)}>
            ×
          </Button>
        )}
      </label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6 text-xs text-zinc-500">
        <span>{document.kind}</span>
        <span>· {document.chunks} passages</span>
        {document.licence &&
          (document.licenceUrl ? (
            <a href={document.licenceUrl} target="_blank" rel="noopener noreferrer" title={`${document.licence}. ${document.attribution ?? ''}`}>
              <Badge variant={document.licence.startsWith('CC BY-ND') ? 'restricted' : 'license'}>{licenceLabel(document.licence)}</Badge>
            </a>
          ) : (
            <Badge variant="license" title={`${document.licence}. ${document.attribution ?? ''}`}>
              {licenceLabel(document.licence)}
            </Badge>
          ))}
        {document.sourceUrl && (
          <a className="text-indigo-700 underline underline-offset-2 dark:text-indigo-300" href={document.sourceUrl} target="_blank" rel="noopener noreferrer">
            source
          </a>
        )}
      </div>
    </li>
  );

  return (
    <section aria-label="Documents">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Documents</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onToggleAll}>
          {selected.size === documents.length ? 'Clear' : 'Select all'}
        </Button>
      </div>
      <ul className="space-y-2">{corpus.map(item)}</ul>
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Your uploads</h3>
      {uploads.length > 0 && <ul className="mb-3 space-y-2">{uploads.map(item)}</ul>}
      <label className="block">
        <span className="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {uploading ? 'Uploading…' : 'Upload a file'}
        </span>
        <input
          type="file"
          className="sr-only"
          accept=".md,.pdf,.txt"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </label>
      <p className="mt-2 text-xs text-zinc-500">md, pdf or txt, up to 4 MB and 40 pages. Only this browser session can see it, and it is deleted after 24 hours.</p>
      {uploadError && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{uploadError}</p>}
    </section>
  );
};
