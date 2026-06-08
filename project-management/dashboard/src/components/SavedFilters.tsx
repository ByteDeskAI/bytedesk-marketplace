import { useState, useEffect, useCallback } from 'react';
import Button from '@atlaskit/button';
import Textfield from '@atlaskit/textfield';
import { Checkbox } from '@atlaskit/checkbox';
import Popup from '@atlaskit/popup';

export interface SavedFilter {
  name: string;
  criteria: Record<string, string>;
}

interface Props {
  onFilterApply: (name: string, criteria: Record<string, string>) => void;
  onFilterClear: () => void;
  activeFilter: string | null;
}

// Criteria options exposed in the inline form
const CRITERIA_OPTIONS: Array<{ key: string; label: string; values: string[] }> = [
  { key: 'status', label: 'Status', values: ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] },
  { key: 'type', label: 'Type', values: ['task', 'bug', 'story', 'epic'] },
  { key: 'priority', label: 'Priority', values: ['low', 'medium', 'high', 'critical'] },
];

// ── FilterChip ────────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function FilterChip({ label, isActive, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: isActive ? 700 : 400,
        cursor: 'pointer',
        background: isActive
          ? 'var(--ds-background-selected)'
          : 'var(--ds-background-neutral)',
        border: isActive
          ? '2px solid var(--ds-border-selected)'
          : '1px solid var(--ds-border)',
        color: isActive ? 'var(--ds-text-selected)' : 'var(--ds-text)',
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

// ── CreateFilterForm ──────────────────────────────────────────────────────────

interface CreateFilterFormProps {
  onSave: (filter: SavedFilter) => void;
  onCancel: () => void;
}

function CreateFilterForm({ onSave, onCancel }: CreateFilterFormProps) {
  const [name, setName] = useState('');
  const [criteria, setCriteria] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const toggleCriteria = (key: string, value: string) => {
    setCriteria(prev => {
      // Only allow one value per key
      if (prev[key] === value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/workspace/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), criteria }),
      });
      onSave({ name: name.trim(), criteria });
    } catch {
      // silently ignore — parent will not add if fetch failed
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 12, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)' }}>New filter</div>

      <Textfield
        placeholder="Filter name"
        value={name}
        onChange={e => setName((e.target as HTMLInputElement).value)}
        autoFocus
      />

      {CRITERIA_OPTIONS.map(opt => (
        <div key={opt.key}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-text-subtle)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {opt.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {opt.values.map(val => (
              <Checkbox
                key={val}
                label={val}
                isChecked={criteria[opt.key] === val}
                onChange={() => toggleCriteria(opt.key, val)}
              />
            ))}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
        <Button appearance="subtle" onClick={onCancel} spacing="compact">Cancel</Button>
        <Button
          appearance="primary"
          onClick={handleSave}
          isDisabled={!name.trim() || saving}
          spacing="compact"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// ── SavedFilters ──────────────────────────────────────────────────────────────

export default function SavedFilters({ onFilterApply, onFilterClear, activeFilter }: Props) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const loadFilters = useCallback(() => {
    fetch('/api/workspace/filters')
      .then(r => r.json())
      .then((data: { filters?: SavedFilter[] }) => {
        if (Array.isArray(data.filters)) {
          setFilters(data.filters.slice(0, 8));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  const handleChipClick = (filter: SavedFilter) => {
    if (activeFilter === filter.name) {
      onFilterClear();
    } else {
      onFilterApply(filter.name, filter.criteria);
    }
  };

  const handleFilterSaved = (filter: SavedFilter) => {
    setFilters(prev => {
      const next = [...prev.filter(f => f.name !== filter.name), filter].slice(0, 8);
      return next;
    });
    setCreateOpen(false);
    onFilterApply(filter.name, filter.criteria);
  };

  if (filters.length === 0 && !createOpen) {
    // Render just the + button when no filters exist yet
    return (
      <div style={{ padding: '6px 24px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--ds-border)', flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>No saved filters</span>
        <Popup
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          placement="bottom-start"
          trigger={(triggerProps: object) => (
            <button
              {...(triggerProps as Record<string, unknown>)}
              onClick={() => setCreateOpen(o => !o)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: 12,
                border: '1px dashed var(--ds-border-bold)',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--ds-text-subtle)',
              }}
              aria-label="Add filter"
            >
              +
            </button>
          )}
          content={() => (
            <CreateFilterForm
              onSave={handleFilterSaved}
              onCancel={() => setCreateOpen(false)}
            />
          )}
        />
      </div>
    );
  }

  return (
    <div style={{
      padding: '6px 24px',
      borderBottom: '1px solid var(--ds-border)',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      overflowX: 'auto',
      scrollbarWidth: 'none',
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ds-text-subtlest)', flexShrink: 0, letterSpacing: '.04em', textTransform: 'uppercase' }}>
        Filters
      </span>
      {filters.map(filter => (
        <FilterChip
          key={filter.name}
          label={filter.name}
          isActive={activeFilter === filter.name}
          onClick={() => handleChipClick(filter)}
        />
      ))}

      {/* + chip to open create form */}
      {filters.length < 8 && (
        <Popup
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          placement="bottom-start"
          trigger={(triggerProps: object) => (
            <button
              {...(triggerProps as Record<string, unknown>)}
              onClick={() => setCreateOpen(o => !o)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: 12,
                border: '1px dashed var(--ds-border-bold)',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--ds-text-subtle)',
                flexShrink: 0,
              }}
              aria-label="Add filter"
            >
              +
            </button>
          )}
          content={() => (
            <CreateFilterForm
              onSave={handleFilterSaved}
              onCancel={() => setCreateOpen(false)}
            />
          )}
        />
      )}
    </div>
  );
}
