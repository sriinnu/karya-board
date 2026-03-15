/**
 * Cmd+K command palette for keyboard-driven navigation and actions.
 * @packageDocumentation
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';

interface CommandPaletteProps {
  /** Close the palette */
  onClose: () => void;
  /** Trigger add-issue modal */
  onAddIssue: () => void;
  /** Trigger AI review modal */
  onSuggestIssues: () => void;
  /** Trigger refresh */
  onRefresh: () => void;
  /** Trigger scanner start */
  onScannerAction: () => void;
  /** Open project management modal */
  onManageProjects?: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  action: () => void;
}

/**
 * Fuzzy-ish case-insensitive match.
 * @internal
 */
function matchesQuery(label: string, query: string): boolean {
  const lower = label.toLowerCase();
  const q = query.toLowerCase();
  return lower.includes(q);
}

/**
 * Command palette overlay with fuzzy search, arrow-key navigation, and Enter to execute.
 * @public
 */
export function CommandPalette({
  onClose,
  onAddIssue,
  onSuggestIssues,
  onRefresh,
  onScannerAction,
  onManageProjects,
}: CommandPaletteProps) {
  const { projects, setSelectedProject, setStatusFilter, setPriorityFilter, toggleFocusMode } = useStore();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: 'new-issue', label: 'New Issue', hint: 'N', group: 'Actions', action: () => { onClose(); onAddIssue(); } },
      { id: 'ai-review', label: 'AI Review', hint: 'A', group: 'Actions', action: () => { onClose(); onSuggestIssues(); } },
      { id: 'refresh', label: 'Refresh Board', hint: 'R', group: 'Actions', action: () => { onClose(); onRefresh(); } },
      { id: 'scanner', label: 'Start / Restart Scanner', group: 'Actions', action: () => { onClose(); onScannerAction(); } },
      { id: 'focus', label: 'Toggle Focus Mode', hint: '⌘.', group: 'Actions', action: () => { onClose(); toggleFocusMode(); } },
      { id: 'manage', label: 'Manage Projects', group: 'Actions', action: () => { onClose(); onManageProjects?.(); } },
      { id: 'nav-deck', label: 'Go to Dashboard', group: 'Navigation', action: () => { onClose(); document.querySelector('#dashboard-overview')?.scrollIntoView({ behavior: 'smooth' }); } },
      { id: 'nav-board', label: 'Go to Board', group: 'Navigation', action: () => { onClose(); document.querySelector('#board-workspace')?.scrollIntoView({ behavior: 'smooth' }); } },
      { id: 'nav-intel', label: 'Go to Project Intelligence', group: 'Navigation', action: () => { onClose(); document.querySelector('#project-intel')?.scrollIntoView({ behavior: 'smooth' }); } },
      { id: 'project-all', label: 'All Projects', group: 'Projects', action: () => { onClose(); setSelectedProject(null); } },
      ...projects.map((p) => ({
        id: `project-${p.id}`,
        label: p.name,
        group: 'Projects',
        action: () => { onClose(); setSelectedProject(p.id); },
      })),
      { id: 'status-all', label: 'Status: All', group: 'Filters', action: () => { onClose(); setStatusFilter('all'); } },
      { id: 'status-open', label: 'Status: Open', group: 'Filters', action: () => { onClose(); setStatusFilter('open'); } },
      { id: 'status-progress', label: 'Status: In Progress', group: 'Filters', action: () => { onClose(); setStatusFilter('in_progress'); } },
      { id: 'status-done', label: 'Status: Done', group: 'Filters', action: () => { onClose(); setStatusFilter('done'); } },
      { id: 'priority-all', label: 'Priority: All', group: 'Filters', action: () => { onClose(); setPriorityFilter('all'); } },
      { id: 'priority-critical', label: 'Priority: Critical', group: 'Filters', action: () => { onClose(); setPriorityFilter('critical'); } },
      { id: 'priority-high', label: 'Priority: High', group: 'Filters', action: () => { onClose(); setPriorityFilter('high'); } },
      { id: 'priority-medium', label: 'Priority: Medium', group: 'Filters', action: () => { onClose(); setPriorityFilter('medium'); } },
      { id: 'priority-low', label: 'Priority: Low', group: 'Filters', action: () => { onClose(); setPriorityFilter('low'); } },
    ];
    return list;
  }, [projects, onClose, onAddIssue, onSuggestIssues, onRefresh, onScannerAction, setSelectedProject, setStatusFilter, setPriorityFilter, toggleFocusMode]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter((item) => matchesQuery(item.label, query) || matchesQuery(item.group, query));
  }, [items, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const item of filtered) {
      (groups[item.group] ??= []).push(item);
    }
    return groups;
  }, [filtered]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) item.action();
      return;
    }
  };

  const flatItems = useMemo(() => {
    const result: Array<{ item: CommandItem; group: string; flatIndex: number }> = [];
    let idx = 0;
    for (const [group, groupItems] of Object.entries(grouped)) {
      for (const item of groupItems) {
        result.push({ item, group, flatIndex: idx++ });
      }
    }
    return result;
  }, [grouped]);

  const groupedFlat = useMemo(() => {
    const groups: Record<string, typeof flatItems> = {};
    for (const entry of flatItems) {
      (groups[entry.group] ??= []).push(entry);
    }
    return groups;
  }, [flatItems]);

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="command-palette-input-wrap">
          <svg className="command-palette-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            aria-activedescendant={filtered[activeIndex]?.id ?? undefined}
            aria-label="Command search"
          />
          <kbd className="command-palette-esc">Esc</kbd>
        </div>
        <div className="command-palette-list" ref={listRef} role="listbox" id="command-palette-listbox">
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}
          {Object.entries(groupedFlat).map(([group, entries]) => (
            <div key={group}>
              <div className="command-palette-group">{group}</div>
              {entries.map(({ item, flatIndex: idx }) => {
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    id={item.id}
                    type="button"
                    className={`command-palette-item${isActive ? ' is-active' : ''}`}
                    data-active={isActive}
                    role="option"
                    aria-selected={isActive}
                    onClick={item.action}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <span className="command-palette-item-label">{item.label}</span>
                    {item.hint && <kbd className="command-palette-item-hint">{item.hint}</kbd>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
