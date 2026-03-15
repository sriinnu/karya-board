/**
 * Project management modal for adding, editing, and removing projects.
 * Also surfaces the raw karya.config.json for direct editing.
 * @packageDocumentation
 */

import { useEffect, useRef, useState } from 'react';
import {
  addProject,
  fetchConfig,
  readFile,
  removeProject,
  saveConfig,
} from '../api';
import { useStore } from '../store';

interface ProjectManageModalProps {
  /** Closes the modal */
  onClose: () => void;
}

type Tab = 'projects' | 'config' | 'file';

/**
 * Full project management modal with CRUD, config editor, and file reader.
 * @public
 */
export function ProjectManageModal({ onClose }: ProjectManageModalProps) {
  const { projects, refresh } = useStore();
  const [tab, setTab] = useState<Tab>('projects');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add project form
  const [addName, setAddName] = useState('');
  const [addPath, setAddPath] = useState('');
  const [addInclude, setAddInclude] = useState('');
  const [addExclude, setAddExclude] = useState('');

  // Config editor
  const [configText, setConfigText] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);

  // File reader
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, onClose]);

  /** Load config when switching to config tab */
  useEffect(() => {
    if (tab === 'config' && !configLoaded) {
      void fetchConfig()
        .then((cfg) => {
          setConfigText(JSON.stringify(cfg, null, 2));
          setConfigLoaded(true);
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load config'));
    }
  }, [tab, configLoaded]);

  const handleAddProject = async () => {
    if (!addName.trim() || !addPath.trim()) {
      setError('Name and path are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addProject({
        name: addName.trim(),
        path: addPath.trim(),
        include: addInclude.trim() ? addInclude.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
        exclude: addExclude.trim() ? addExclude.split('\n').map((s) => s.trim()).filter(Boolean) : undefined,
      });
      setAddName('');
      setAddPath('');
      setAddInclude('');
      setAddExclude('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add project');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveProject = async (projectId: string, projectName: string) => {
    if (!window.confirm(`Remove "${projectName}" from the workspace?`)) return;
    setBusy(true);
    setError(null);
    try {
      await removeProject(projectId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove project');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(configText);
      await saveConfig(parsed);
      await refresh();
      setConfigLoaded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    } finally {
      setBusy(false);
    }
  };

  const handleReadFile = async () => {
    if (!filePath.trim()) return;
    setBusy(true);
    setError(null);
    setFileContent(null);
    try {
      const content = await readFile(filePath.trim());
      setFileContent(content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '780px' }}
      >
        <div className="modal-header">
          <div>
            <p className="modal-kicker">Workspace</p>
            <h2 id="manage-modal-title" className="modal-title">Manage Projects</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-tabs">
          {(['projects', 'config', 'file'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`modal-tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'projects' ? 'Projects' : t === 'config' ? 'Config Editor' : 'File Reader'}
            </button>
          ))}
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="modal-body">
          {tab === 'projects' && (
            <div className="space-y-md">
              <div className="project-manage-list">
                {projects.length === 0 && (
                  <p className="text-muted text-sm">No projects configured yet. Add one below.</p>
                )}
                {projects.map((project) => (
                  <div key={project.id} className="project-manage-row">
                    <div className="flex-1">
                      <strong className="project-manage-name">{project.name}</strong>
                      <p className="project-manage-path">{project.path}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ minHeight: '34px', fontSize: '0.82rem' }}
                      onClick={() => { void handleRemoveProject(project.id, project.name); }}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="project-manage-form">
                <h3 className="font-semibold" style={{ fontSize: '1rem' }}>Add Project</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="pm-name">Name</label>
                    <input id="pm-name" className="input" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="my-project" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pm-path">Path</label>
                    <input id="pm-path" className="input" value={addPath} onChange={(e) => setAddPath(e.target.value)} placeholder="./my-project or /absolute/path" />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" htmlFor="pm-include">Include (one per line)</label>
                    <textarea id="pm-include" className="textarea" rows={3} value={addInclude} onChange={(e) => setAddInclude(e.target.value)} placeholder="*.md&#10;*.ts" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="pm-exclude">Exclude (one per line)</label>
                    <textarea id="pm-exclude" className="textarea" rows={3} value={addExclude} onChange={(e) => setAddExclude(e.target.value)} placeholder="node_modules&#10;dist" />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { void handleAddProject(); }}
                  disabled={busy || !addName.trim() || !addPath.trim()}
                >
                  {busy ? 'Adding...' : 'Add Project'}
                </button>
              </div>
            </div>
          )}

          {tab === 'config' && (
            <div className="space-y-md">
              <p className="text-muted text-sm">
                Direct edit of karya.config.json. Changes take effect after saving and restarting the scanner.
              </p>
              <textarea
                className="textarea"
                rows={18}
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: '0.84rem', lineHeight: '1.5' }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { void handleSaveConfig(); }}
                disabled={busy}
              >
                {busy ? 'Saving...' : 'Save Config'}
              </button>
            </div>
          )}

          {tab === 'file' && (
            <div className="space-y-md">
              <p className="text-muted text-sm">
                Read any file from configured project directories (JSON, markdown, config files, etc).
              </p>
              <div className="flex gap-sm">
                <input
                  className="input flex-1"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/absolute/path/to/file.json"
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleReadFile(); }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { void handleReadFile(); }}
                  disabled={busy || !filePath.trim()}
                >
                  {busy ? 'Reading...' : 'Read'}
                </button>
              </div>
              {fileContent !== null && (
                <pre
                  className="file-content-pre"
                  style={{
                    maxHeight: '400px',
                    overflow: 'auto',
                    padding: '16px',
                    borderRadius: '16px',
                    background: 'rgba(17, 24, 39, 0.04)',
                    border: '1px solid rgba(17, 24, 39, 0.06)',
                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                    fontSize: '0.82rem',
                    lineHeight: '1.55',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {fileContent}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
