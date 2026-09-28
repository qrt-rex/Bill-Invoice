import { useRef, useState } from 'react';
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../auth';
import { PageHeader } from '../Shell';
import { api, ApiError, saveBlob } from '../lib/api';
import { dateTime } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Table, type Column } from '../ui/Table';
import { useToast } from '../ui/ToastContext';

interface Doc { id: number; original_filename: string; content_type: string; size: number; uploaded_by_email: string; created_at: string }

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** resources.php: shared files every billing user can download; admins can delete. */
export function Documents() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const list = useApi(() => api.get<Doc[]>('/documents'));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      await api.post('/documents', body);
      showToast(`${file.name} uploaded`, 'success');
      list.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Upload failed.', 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const download = async (d: Doc) => {
    try {
      saveBlob(await api.blob(`/documents/${d.id}/download`), d.original_filename);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    }
  };

  const remove = async (d: Doc) => {
    if (!(await confirm({ title: `Delete ${d.original_filename}?`, tone: 'danger', confirmText: 'Delete', message: 'Everyone loses access to this file.' }))) return;
    try {
      await api.delete(`/documents/${d.id}`);
      list.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete the file.', 'error');
    }
  };

  const columns: Column<Doc>[] = [
    { key: 'name', header: 'File', render: (d) => <span className="font-medium text-text">{d.original_filename}</span> },
    { key: 'size', header: 'Size', align: 'right', render: (d) => size(d.size) },
    { key: 'by', header: 'Uploaded by', render: (d) => <span className="text-text-muted">{d.uploaded_by_email || '—'}</span> },
    { key: 'at', header: 'Uploaded', render: (d) => <span className="whitespace-nowrap text-text-muted">{dateTime(d.created_at)}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (d) => (
      <div className="flex justify-end gap-1">
        <Button size="icon-sm" variant="ghost" aria-label={`Download ${d.original_filename}`} onClick={() => download(d)}><Download size={15} /></Button>
        {can('documents.delete') && <Button size="icon-sm" variant="danger-ghost" aria-label={`Delete ${d.original_filename}`} onClick={() => remove(d)}><Trash2 size={15} /></Button>}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader title="Documents" description="Shared billing resources: brochures, rate cards, templates."
        actions={can('documents.upload') && (
          <>
            <input ref={input} type="file" className="sr-only" aria-label="Choose a file to upload" onChange={(e) => upload(e.target.files?.[0])} />
            <Button loading={busy} onClick={() => input.current?.click()}><Upload size={16} /> Upload file</Button>
          </>
        )} />
      <Card>
        {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
          <Table columns={columns} rows={list.data ?? []} rowKey={(d) => String(d.id)} loading={list.loading}
            empty={<EmptyState icon={FolderOpen} title="No documents yet" description="Files you upload are shared with everyone in billing." />} />
        )}
      </Card>
    </>
  );
}
