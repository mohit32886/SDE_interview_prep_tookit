import { useEffect, useRef, useState } from 'react';
import { Search, X, ArrowRight } from 'lucide-react';
import type { SearchResult } from '../types';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectResult: (moduleId: string, file: string, sectionId?: string) => void;
}

export function SearchDialog({ open, onClose, onSelectResult }: SearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 20);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Safari fallback for <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
    const onClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    };
    dialog.addEventListener('click', onClick);
    return () => dialog.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        setResults(data.results || []);
        setActiveIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      const item = results[activeIndex];
      onSelectResult(item.moduleId, item.file, item.sectionId);
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="search-dialog"
      aria-labelledby="search-dialog-title"
      onClose={onClose}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="search-header">
        <Search size={18} className="search-icon" />
        <label htmlFor="global-search-input" id="search-dialog-title" className="sr-only">
          Search interview prep guides
        </label>
        <input
          ref={inputRef}
          id="global-search-input"
          type="search"
          placeholder="Search Java, MVCC, Saga, Kafka ISR, System Design, STAR..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">
          <X size={18} />
        </button>
      </div>

      <div className="search-results">
        {loading && <div className="search-empty">Searching across all 10 modules...</div>}
        {!loading && query.trim().length < 2 && (
          <div className="search-empty">
            Type at least 2 characters to search 80+ guides, diagrams, and Q&amp;As.
          </div>
        )}
        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div className="search-empty">No matches found for &ldquo;{query}&rdquo;.</div>
        )}
        {results.map((item, idx) => (
          <button
            key={`${item.moduleId}-${item.file}-${idx}`}
            type="button"
            className={`search-result-item ${idx === activeIndex ? 'active' : ''}`}
            onClick={() => {
              onSelectResult(item.moduleId, item.file, item.sectionId);
              onClose();
            }}
          >
            <div className="search-result-meta">
              <span className="module-pill" style={{ borderColor: item.accent, color: item.accent }}>
                {item.moduleTitle}
              </span>
              <span className="search-guide-name">{item.guideTitle}</span>
              <ArrowRight size={12} />
              <span className="search-section-name">{item.section}</span>
            </div>
            <p className="search-snippet">{item.snippet}</p>
          </button>
        ))}
      </div>
    </dialog>
  );
}
