import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  RotateCcw,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import type { FlashcardItem, FlashcardRating, ModuleInfo } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface FlashcardsViewProps {
  modules: ModuleInfo[];
  ratings: Record<string, FlashcardRating>;
  isDark: boolean;
  onRate: (cardId: string, rating: FlashcardRating) => void;
  onOpenGuide: (moduleId: string, file: string) => void;
}

export function FlashcardsView({
  modules,
  ratings,
  isDark,
  onRate,
  onOpenGuide,
}: FlashcardsViewProps) {
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState<string>('ALL');
  const [weakOnly, setWeakOnly] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/flashcards')
      .then((r) => r.json())
      .then((data) => setCards(data.flashcards || []))
      .finally(() => setLoading(false));
  }, []);

  const deck = useMemo(() => {
    return cards.filter((c) => {
      if (moduleFilter !== 'ALL' && c.moduleId !== moduleFilter) return false;
      if (weakOnly) {
        const r = ratings[c.id];
        return r === 'again' || r === 'hard' || !r;
      }
      return true;
    });
  }, [cards, moduleFilter, weakOnly, ratings]);

  useEffect(() => {
    setIndex(0);
    setRevealed(false);
  }, [moduleFilter, weakOnly]);

  const current = deck[index] || null;

  const stats = useMemo(() => {
    let mastered = 0;
    let hard = 0;
    let again = 0;
    for (const c of cards) {
      const r = ratings[c.id];
      if (r === 'good') mastered++;
      else if (r === 'hard') hard++;
      else if (r === 'again') again++;
    }
    return { total: cards.length, mastered, hard, again };
  }, [cards, ratings]);

  const handleRate = (rating: FlashcardRating) => {
    if (!current) return;
    onRate(current.id, rating);
    setRevealed(false);
    setIndex((i) => (i + 1 < deck.length ? i + 1 : 0));
  };

  const shuffleDeck = () => {
    setCards((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
    setIndex(0);
    setRevealed(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed((r) => !r);
      } else if (e.key === 'ArrowRight') {
        setRevealed(false);
        setIndex((i) => (deck.length ? (i + 1) % deck.length : 0));
      } else if (e.key === 'ArrowLeft') {
        setRevealed(false);
        setIndex((i) => (deck.length ? (i - 1 + deck.length) % deck.length : 0));
      } else if (revealed && e.key === '1') {
        handleRate('again');
      } else if (revealed && e.key === '2') {
        handleRate('hard');
      } else if (revealed && e.key === '3') {
        handleRate('good');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <main className="studio-mode-main">
      <div className="mode-header">
        <div>
          <div className="hero-eyebrow">Active Recall · Spaced Repetition</div>
          <h1>Flashcard Q&amp;A Drill</h1>
          <p>
            Auto-extracted from all 13 modules. Press <kbd>Space</kbd> to reveal,{' '}
            <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> to rate.
          </p>
        </div>

        <div className="flashcard-stats-strip">
          <span className="fc-stat">Total: {stats.total}</span>
          <span className="fc-stat good">Mastered: {stats.mastered}</span>
          <span className="fc-stat hard">Hard: {stats.hard}</span>
          <span className="fc-stat again">Again: {stats.again}</span>
        </div>
      </div>

      <div className="flashcard-controls">
        <select
          aria-label="Filter flashcards by module"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
        >
          <option value="ALL">All 13 Modules ({cards.length} cards)</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.number} · {m.shortTitle}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`action-pill ${weakOnly ? 'active-accent' : ''}`}
          onClick={() => setWeakOnly((v) => !v)}
        >
          <RotateCcw size={14} />
          Due / Unmastered Only
        </button>

        <button type="button" className="action-pill" onClick={shuffleDeck}>
          <Shuffle size={14} />
          Shuffle
        </button>
      </div>

      {loading ? (
        <div className="reader-loading">Extracting interview Q&amp;As across modules...</div>
      ) : !current ? (
        <div className="empty-state-card">
          <Sparkles size={24} />
          <h3>No matching flashcards</h3>
          <p>Try switching to All Modules or turning off &ldquo;Due / Unmastered Only&rdquo;.</p>
        </div>
      ) : (
        <div className="flashcard-stage">
          <div className="flashcard-meta-bar">
            <span className="module-pill" style={{ borderColor: current.accent, color: current.accent }}>
              {current.moduleTitle}
            </span>
            <span className="fc-guide-link">{current.guideTitle}</span>
            <span className="fc-counter">
              Card {index + 1} / {deck.length}
            </span>
          </div>

          <div className="flashcard-card">
            <div className="flashcard-question">
              <span className="fc-q-label">Interview Question</span>
              <h2>{current.question}</h2>
            </div>

            {!revealed ? (
              <div className="flashcard-reveal-wrap">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setRevealed(true)}
                >
                  <Eye size={16} />
                  Reveal Answer (Space)
                </button>
              </div>
            ) : (
              <div className="flashcard-answer">
                <div className="fc-answer-divider">Reference Answer</div>
                <MarkdownRenderer content={current.answer} isDark={isDark} />
              </div>
            )}
          </div>

          <div className="flashcard-footer">
            <div className="fc-nav-btns">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setRevealed(false);
                  setIndex((i) => (i - 1 + deck.length) % deck.length);
                }}
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => onOpenGuide(current.moduleId, current.file)}
              >
                <BookOpen size={15} /> Open Full Guide
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setRevealed(false);
                  setIndex((i) => (i + 1) % deck.length);
                }}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>

            {revealed && (
              <div className="fc-rate-btns">
                <button
                  type="button"
                  className="rate-btn again"
                  onClick={() => handleRate('again')}
                >
                  1 · Again (Forgot)
                </button>
                <button
                  type="button"
                  className="rate-btn hard"
                  onClick={() => handleRate('hard')}
                >
                  2 · Hard (Shaky)
                </button>
                <button
                  type="button"
                  className="rate-btn good"
                  onClick={() => handleRate('good')}
                >
                  3 · Good (Mastered)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
