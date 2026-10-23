'use client';

import { useEffect, useState } from 'react';

type Catalog = {
  macArm: string;
  macIntel: string;
  windowsX64: string;
  windowsArm: string;
  version: string;
  releaseNotes: string;
};

const empty: Catalog = { macArm: '', macIntel: '', windowsX64: '', windowsArm: '', version: '', releaseNotes: '' };

const fields: Array<{ key: keyof Catalog; label: string }> = [
  { key: 'macArm', label: 'macOS Apple silicon (.dmg)' },
  { key: 'macIntel', label: 'macOS Intel (.dmg)' },
  { key: 'windowsX64', label: 'Windows x64 (.exe / .msi)' },
  { key: 'windowsArm', label: 'Windows arm64' },
];

export function AdminDownloadsPanel() {
  const [catalog, setCatalog] = useState<Catalog>(empty);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/downloads')
      .then(response => response.json())
      .then(body => { if (body.error) throw new Error(body.error); setCatalog({ ...empty, ...body }); })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load downloads.'));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/downloads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Save failed.');
      setMessage('Download links saved. The public /download page updates immediately.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="card mb-4">
    <div className="card-header"><h3 className="card-title">Desktop downloads</h3></div>
    <form className="card-body" onSubmit={save}>
      <p className="text-body-secondary small">HTTPS links only (GitHub Releases, R2, CDN). Users install the app, then link this computer from Settings → Account.</p>
      <div className="row g-3">
        <div className="col-md-4">
          <label className="form-label">Version label</label>
          <input className="form-control" value={catalog.version} onChange={event => setCatalog({ ...catalog, version: event.target.value })} placeholder="1.0.0" />
        </div>
      </div>
      {fields.map(field => (
        <div key={field.key} className="mt-3">
          <label className="form-label">{field.label}</label>
          <input className="form-control font-monospace small" type="url" value={catalog[field.key]} onChange={event => setCatalog({ ...catalog, [field.key]: event.target.value })} placeholder="https://…" />
        </div>
      ))}
      <div className="mt-3">
        <label className="form-label">Release notes (optional)</label>
        <textarea className="form-control" rows={4} value={catalog.releaseNotes} onChange={event => setCatalog({ ...catalog, releaseNotes: event.target.value })} />
      </div>
      {error ? <div className="alert alert-danger mt-3 mb-0">{error}</div> : null}
      {message ? <div className="alert alert-success mt-3 mb-0">{message}</div> : null}
      <button type="submit" className="btn btn-primary mt-3" disabled={saving}>{saving ? 'Saving…' : 'Save download links'}</button>
    </form>
  </div>;
}
