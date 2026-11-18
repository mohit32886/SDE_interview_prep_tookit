import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Compass,
  FileText,
  GitBranch,
  Layers,
  Menu,
  Monitor,
  Moon,
  Search,
  Sparkles,
  StickyNote,
  Sun,
  Timer,
  X,
} from 'lucide-react';
import type {
  ConfidenceLevel,
  FlashcardRating,
  GuideDetail,
  MockSessionRecord,
  ModuleInfo,
  StudyProgress,
} from './types';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { SearchDialog } from './components/SearchDialog';
import { FlashcardsView } from './components/FlashcardsView';
import { MockInterviewView } from './components/MockInterviewView';

type ThemePref = 'light dark' | 'light' | 'dark';

interface RouteState {
  view: 'dashboard' | 'guide' | 'flashcards' | 'mock';
  moduleId?: string;
  file?: string;
  sectionId?: string;
}

function resolveIsDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function parseRoute(): RouteState {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!hash || hash === '/') return { view: 'dashboard' };
  const [pathPart, sectionId] = hash.split('#');
  const parts = pathPart.split('/').filter(Boolean);
  if (parts[0] === 'flashcards') return { view: 'flashcards' };
  if (parts[0] === 'mock') return { view: 'mock' };
  if (parts[0] === 'guide' && parts[1]) {
    return {
      view: 'guide',
      moduleId: decodeURIComponent(parts[1]),
      file: parts[2] ? decodeURIComponent(parts[2]) : 'README.md',
      sectionId,
    };
  }
  return { view: 'dashboard' };
}

export function App() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);
  const [route, setRoute] = useState<RouteState>(parseRoute);
  const [guide, setGuide] = useState<GuideDetail | null>(null);
  const [loadingGuide, setLoadingGuide] = useState(false);
  const [activeHeading, setActiveHeading] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const [progress, setProgress] = useState<StudyProgress>({
    completed: [],
    bookmarks: [],
    notes: {},
    confidence: {},
    flashcardRatings: {},
    mockHistory: [],
    lastVisited: null,
  });

  const [themePref, setThemePref] = useState<ThemePref>(() => {
    try {
      const saved = localStorage.getItem('color-scheme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'light dark';
  });
  const [isDark, setIsDark] = useState(() => resolveIsDark(themePref));

  // Sync <meta name="color-scheme"> and system media listener
  useEffect(() => {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', themePref);
    try {
      if (themePref === 'light dark') {
        localStorage.removeItem('color-scheme');
      } else {
        localStorage.setItem('color-scheme', themePref);
      }
    } catch {}
    setIsDark(resolveIsDark(themePref));

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMqChange = () => setIsDark(resolveIsDark(themePref));
    mq.addEventListener('change', onMqChange);
    return () => mq.removeEventListener('change', onMqChange);
  }, [themePref]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next: ThemePref = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'light dark';
        setThemePref(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/modules').then((r) => r.json()),
      fetch('/api/progress').then((r) => r.json()),
    ])
      .then(([modData, progData]) => {
        setModules(modData.modules || []);
        if (progData) {
          setProgress({
            completed: progData.completed || [],
            bookmarks: progData.bookmarks || [],
            notes: progData.notes || {},
            confidence: progData.confidence || {},
            flashcardRatings: progData.flashcardRatings || {},
            mockHistory: progData.mockHistory || [],
            lastVisited: progData.lastVisited || null,
          });
        }
      })
      .finally(() => setLoadingModules(false));
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (
        e.key === '/' &&
        !searchOpen &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchOpen]);

  const persistProgress = useCallback(async (next: StudyProgress) => {
    setProgress(next);
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (route.view !== 'guide' || !route.moduleId || !route.file) {
      setGuide(null);
      return;
    }
    setLoadingGuide(true);
    fetch(`/api/guide?module=${encodeURIComponent(route.moduleId)}&file=${encodeURIComponent(route.file)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setGuide(data);
          setActiveHeading(data.toc?.[0]?.id || '');
          setProgress((prev) => {
            const next = {
              ...prev,
              lastVisited: { moduleId: route.moduleId!, file: route.file! },
            };
            fetch('/api/progress', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lastVisited: next.lastVisited }),
            }).catch(() => {});
            return next;
          });
          if (route.sectionId) {
            setTimeout(() => {
              document.getElementById(route.sectionId!)?.scrollIntoView({ behavior: 'smooth' });
            }, 120);
          } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      })
      .finally(() => setLoadingGuide(false));
  }, [route.view, route.moduleId, route.file, route.sectionId]);

  useEffect(() => {
    if (!guide?.toc?.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveHeading(entry.target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px' }
    );
    for (const item of guide.toc) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [guide]);

  const navigateHome = () => {
    window.location.hash = '/';
    setSidebarOpen(false);
  };

  const navigateMode = (mode: 'flashcards' | 'mock') => {
    window.location.hash = `/${mode}`;
    setSidebarOpen(false);
  };

  const navigateGuide = (moduleId: string, file: string, sectionId?: string) => {
    const base = `#/guide/${encodeURIComponent(moduleId)}/${encodeURIComponent(file)}`;
    window.location.hash = sectionId ? `${base}#${sectionId}` : base;
    setSidebarOpen(false);
  };

  const cycleTheme = () => {
    setThemePref((prev) => {
      if (prev === 'light dark') return isDark ? 'light' : 'dark';
      if (prev === 'dark') return 'light';
      return 'light dark';
    });
  };

  const totalStats = useMemo(() => {
    let guides = 0;
    let lines = 0;
    let mermaid = 0;
    let svgs = 0;
    for (const m of modules) {
      guides += m.guides.length;
      lines += m.totalLines;
      mermaid += m.totalMermaid;
      svgs += m.totalSvgs;
    }
    return { guides, lines, mermaid, svgs };
  }, [modules]);

  const activeModule = useMemo(
    () => modules.find((m) => m.id === route.moduleId) || null,
    [modules, route.moduleId]
  );

  const guideKey = guide ? `${guide.moduleId}/${guide.file}` : '';
  const currentConfidence: ConfidenceLevel | undefined = guideKey
    ? progress.confidence[guideKey] || (progress.completed.includes(guideKey) ? 'ready' : undefined)
    : undefined;
  const isBookmarked = guideKey ? progress.bookmarks.includes(guideKey) : false;

  const setGuideConfidence = (level: ConfidenceLevel) => {
    if (!guideKey) return;
    const nextConfidence = { ...progress.confidence, [guideKey]: level };
    const nextCompleted =
      level === 'ready'
        ? Array.from(new Set([...progress.completed, guideKey]))
        : progress.completed.filter((k) => k !== guideKey);
    persistProgress({
      ...progress,
      confidence: nextConfidence,
      completed: nextCompleted,
    });
  };

  const toggleBookmark = () => {
    if (!guideKey) return;
    const bookmarks = isBookmarked
      ? progress.bookmarks.filter((k) => k !== guideKey)
      : [...progress.bookmarks, guideKey];
    persistProgress({ ...progress, bookmarks });
  };

  const updateNote = (text: string) => {
    if (!guideKey) return;
    persistProgress({
      ...progress,
      notes: { ...progress.notes, [guideKey]: text },
    });
  };

  const handleFlashcardRate = (cardId: string, rating: FlashcardRating) => {
    persistProgress({
      ...progress,
      flashcardRatings: { ...progress.flashcardRatings, [cardId]: rating },
    });
  };

  const handleSaveMock = (record: MockSessionRecord) => {
    persistProgress({
      ...progress,
      mockHistory: [record, ...progress.mockHistory].slice(0, 20),
    });
  };

  const revisionQueue = useMemo(() => {
    const items: Array<{ key: string; level: ConfidenceLevel; title: string; moduleId: string; file: string }> = [];
    for (const [key, level] of Object.entries(progress.confidence)) {
      if (level !== 'review' && level !== 'shaky') continue;
      const [mId, fName] = key.split('/');
      const mod = modules.find((m) => m.id === mId);
      const g = mod?.guides.find((item) => item.file === fName);
      if (mod && g) {
        items.push({ key, level, title: g.title, moduleId: mId, file: fName });
      }
    }
    return items;
  }, [progress.confidence, modules]);

  const prevNext = useMemo(() => {
    if (!activeModule || !guide) return { prev: null, next: null };
    const idx = activeModule.guides.findIndex((g) => g.file === guide.file);
    return {
      prev: idx > 0 ? activeModule.guides[idx - 1] : null,
      next: idx >= 0 && idx < activeModule.guides.length - 1 ? activeModule.guides[idx + 1] : null,
    };
  }, [activeModule, guide]);

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="nav-left">
          {route.view === 'guide' && (
            <button
              type="button"
              className="icon-btn mobile-only"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle module navigation"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          )}
          <button type="button" className="brand-btn" onClick={navigateHome}>
            <span className="brand-mark">
              <Sparkles size={16} />
            </span>
            <span className="brand-text">SDE Prep Studio</span>
          </button>

          <nav className="nav-mode-links" aria-label="Study modes">
            <button
              type="button"
              className={`nav-mode-btn ${route.view === 'dashboard' ? 'active' : ''}`}
              onClick={navigateHome}
            >
              Modules
            </button>
            <button
              type="button"
              className={`nav-mode-btn ${route.view === 'flashcards' ? 'active' : ''}`}
              onClick={() => navigateMode('flashcards')}
            >
              <Brain size={14} /> Flashcards
            </button>
            <button
              type="button"
              className={`nav-mode-btn ${route.view === 'mock' ? 'active' : ''}`}
              onClick={() => navigateMode('mock')}
            >
              <Timer size={14} /> Mock Timer
            </button>
          </nav>
        </div>

        <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          <span>Search guides, diagrams, Q&amp;As...</span>
          <kbd>⌘K</kbd>
        </button>

        <div className="nav-right">
          <div className="progress-pill" title="Guides marked Interview Ready">
            <CheckCircle2 size={14} />
            <span>
              {progress.completed.length}/{totalStats.guides || 0} ready
            </span>
          </div>
          <button
            type="button"
            className="theme-btn"
            onClick={cycleTheme}
            title={`Theme: ${themePref === 'light dark' ? 'System' : themePref}`}
            aria-label="Toggle color theme"
          >
            {themePref === 'light dark' ? (
              <Monitor size={16} />
            ) : themePref === 'dark' ? (
              <Moon size={16} />
            ) : (
              <Sun size={16} />
            )}
            <span className="theme-label">
              {themePref === 'light dark' ? 'System' : themePref === 'dark' ? 'Dark' : 'Light'}
            </span>
          </button>
        </div>
      </header>

      {route.view === 'flashcards' ? (
        <FlashcardsView
          modules={modules}
          ratings={progress.flashcardRatings}
          isDark={isDark}
          onRate={handleFlashcardRate}
          onOpenGuide={(mId, fName) => navigateGuide(mId, fName)}
        />
      ) : route.view === 'mock' ? (
        <MockInterviewView
          modules={modules}
          history={progress.mockHistory}
          onSaveSession={handleSaveMock}
          onOpenGuide={(mId, fName) => navigateGuide(mId, fName)}
        />
      ) : route.view === 'dashboard' ? (
        <main className="dashboard-main">
          <section className="hero-banner">
            <div className="hero-content">
              <div className="hero-eyebrow">{modules.length || 13}-Module Visual Interview Toolkit</div>
              <h1>Master Backend, System Design &amp; FAANG Interviews Visually</h1>
              <p>
                Interactive Mermaid architecture diagrams, animated SVG flows, active-recall
                flashcards, timed mock interviews, and confidence tracking.
              </p>
              <div className="hero-actions">
                {progress.lastVisited ? (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() =>
                      navigateGuide(progress.lastVisited!.moduleId, progress.lastVisited!.file)
                    }
                  >
                    <Compass size={16} />
                    Continue Studying
                  </button>
                ) : (
                  modules[0] && (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => navigateGuide(modules[0].id, modules[0].guides[0]?.file || 'README.md')}
                    >
                      <BookOpen size={16} />
                      Start Module 01
                    </button>
                  )
                )}
                <button type="button" className="secondary-btn" onClick={() => navigateMode('flashcards')}>
                  <Brain size={16} />
                  Flashcard Drill
                </button>
                <button type="button" className="secondary-btn" onClick={() => navigateMode('mock')}>
                  <Timer size={16} />
                  45m Mock Interview
                </button>
              </div>
            </div>

            <div className="hero-stats-grid">
              <div className="stat-card">
                <span className="stat-value">{modules.length}</span>
                <span className="stat-label">Deep-Dive Modules</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{totalStats.guides}</span>
                <span className="stat-label">Visual Study Guides</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{totalStats.mermaid.toLocaleString()}</span>
                <span className="stat-label">Mermaid Diagrams</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{totalStats.svgs}</span>
                <span className="stat-label">Animated SVGs</span>
              </div>
            </div>
          </section>

          {revisionQueue.length > 0 && (
            <section className="bookmarks-strip">
              <h2>Revision Queue (Needs Review / Shaky)</h2>
              <div className="bookmark-chips">
                {revisionQueue.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`bookmark-chip conf-chip-${item.level}`}
                    onClick={() => navigateGuide(item.moduleId, item.file)}
                  >
                    <AlertTriangle size={13} />
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {progress.bookmarks.length > 0 && (
            <section className="bookmarks-strip">
              <h2>Bookmarked Guides</h2>
              <div className="bookmark-chips">
                {progress.bookmarks.map((key) => {
                  const [mId, fName] = key.split('/');
                  const mod = modules.find((m) => m.id === mId);
                  const g = mod?.guides.find((item) => item.file === fName);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="bookmark-chip"
                      onClick={() => navigateGuide(mId, fName)}
                    >
                      <Bookmark size={13} />
                      <span>{g?.title || fName}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="modules-section">
            <div className="section-heading">
              <h2>Study Modules</h2>
              <span>Click any module to open its visual reader</span>
            </div>

            {loadingModules ? (
              <div className="loading-grid">Loading modules...</div>
            ) : (
              <div className="modules-grid">
                {modules.map((mod) => {
                  const doneCount = mod.guides.filter((g) =>
                    progress.completed.includes(`${mod.id}/${g.file}`)
                  ).length;
                  const pct = mod.guides.length
                    ? Math.round((doneCount / mod.guides.length) * 100)
                    : 0;

                  return (
                    <article
                      key={mod.id}
                      className="module-card"
                      style={{ '--mod-accent': mod.accent } as React.CSSProperties}
                    >
                      <div className="module-card-top">
                        <span className="module-num">{mod.number}</span>
                        <span className="module-badge">{mod.badge}</span>
                      </div>

                      <h3>{mod.shortTitle}</h3>
                      <p className="module-desc">{mod.description}</p>

                      {mod.previewSvg && (
                        <div className="module-svg-thumb">
                          <img src={mod.previewSvg} alt={`${mod.shortTitle} preview`} loading="lazy" />
                        </div>
                      )}

                      <div className="module-meta-row">
                        <span>
                          <FileText size={13} /> {mod.guides.length} guides
                        </span>
                        <span>
                          <GitBranch size={13} /> {mod.totalMermaid} diagrams
                        </span>
                        <span>
                          <Layers size={13} /> {mod.assets.length} SVGs
                        </span>
                      </div>

                      <div className="module-progress-bar">
                        <div className="module-progress-fill" style={{ width: `${pct}%` }} />
                      </div>

                      <div className="module-card-footer">
                        <span className="progress-text">
                          {doneCount}/{mod.guides.length} ready
                        </span>
                        <button
                          type="button"
                          className="open-module-btn"
                          onClick={() =>
                            navigateGuide(mod.id, mod.guides[0]?.file || 'README.md')
                          }
                        >
                          Open Module <ChevronRight size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      ) : (
        <div className="reader-layout">
          <aside className={`reader-sidebar ${sidebarOpen ? 'open' : ''}`}>
            <div className="sidebar-module-select">
              <button type="button" className="back-home-link" onClick={navigateHome}>
                <ChevronLeft size={15} /> All {modules.length} Modules
              </button>
              <label htmlFor="module-switcher" className="sr-only">
                Switch module
              </label>
              <select
                id="module-switcher"
                value={route.moduleId}
                onChange={(e) => {
                  const nextMod = modules.find((m) => m.id === e.target.value);
                  if (nextMod) navigateGuide(nextMod.id, nextMod.guides[0]?.file || 'README.md');
                }}
              >
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.number} · {m.shortTitle}
                  </option>
                ))}
              </select>
            </div>

            <nav className="sidebar-guide-list" aria-label="Module guides">
              {activeModule?.guides.map((g) => {
                const isActive = g.file === route.file;
                const key = `${activeModule.id}/${g.file}`;
                const conf = progress.confidence[key] || (progress.completed.includes(key) ? 'ready' : undefined);
                return (
                  <button
                    key={g.file}
                    type="button"
                    className={`sidebar-guide-item ${isActive ? 'active' : ''}`}
                    onClick={() => navigateGuide(activeModule.id, g.file)}
                  >
                    <span className="guide-status-icon">
                      {conf === 'ready' ? (
                        <CheckCircle2 size={15} className="done-icon" />
                      ) : conf === 'shaky' ? (
                        <Circle size={15} className="shaky-icon" />
                      ) : conf === 'review' ? (
                        <AlertTriangle size={15} className="review-icon" />
                      ) : (
                        <Circle size={15} />
                      )}
                    </span>
                    <span className="guide-item-text">
                      <span className="guide-item-title">{g.title}</span>
                      <span className="guide-item-sub">
                        {g.readingMinutes}m · {g.mermaidCount} diagrams
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="reader-main">
            {loadingGuide || !guide ? (
              <div className="reader-loading">Loading study guide...</div>
            ) : (
              <>
                <div className="guide-header-card">
                  <div className="guide-breadcrumbs">
                    <span>{activeModule?.shortTitle}</span>
                    <ChevronRight size={13} />
                    <span>{guide.file}</span>
                  </div>

                  <div className="guide-stats-bar">
                    <span>{guide.readingMinutes} min read</span>
                    <span>{guide.lineCount.toLocaleString()} lines</span>
                    <span>{guide.mermaidCount} Mermaid diagrams</span>
                    <span>{guide.svgCount} Animated SVGs</span>
                  </div>

                  <div className="guide-actions-bar">
                    <div className="confidence-group" role="group" aria-label="Confidence rating">
                      <button
                        type="button"
                        className={`conf-btn review ${currentConfidence === 'review' ? 'active' : ''}`}
                        onClick={() => setGuideConfidence('review')}
                      >
                        Needs Review
                      </button>
                      <button
                        type="button"
                        className={`conf-btn shaky ${currentConfidence === 'shaky' ? 'active' : ''}`}
                        onClick={() => setGuideConfidence('shaky')}
                      >
                        Shaky
                      </button>
                      <button
                        type="button"
                        className={`conf-btn ready ${currentConfidence === 'ready' ? 'active' : ''}`}
                        onClick={() => setGuideConfidence('ready')}
                      >
                        Interview Ready
                      </button>
                    </div>

                    <button
                      type="button"
                      className={`action-pill ${isBookmarked ? 'active-accent' : ''}`}
                      onClick={toggleBookmark}
                    >
                      <Bookmark size={15} />
                      {isBookmarked ? 'Bookmarked' : 'Bookmark'}
                    </button>
                    <button
                      type="button"
                      className={`action-pill ${notesOpen ? 'active-accent' : ''}`}
                      onClick={() => setNotesOpen((v) => !v)}
                    >
                      <StickyNote size={15} />
                      My Notes
                    </button>
                  </div>

                  {notesOpen && (
                    <div className="notes-drawer">
                      <label htmlFor="guide-notes">Personal Study Notes (auto-saved)</label>
                      <textarea
                        id="guide-notes"
                        rows={4}
                        placeholder="Jot down key formulas, edge cases, or interview follow-ups..."
                        value={progress.notes[guideKey] || ''}
                        onChange={(e) => updateNote(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <MarkdownRenderer
                  content={guide.content}
                  isDark={isDark}
                  onNavigateFile={(targetFile) => navigateGuide(guide.moduleId, targetFile)}
                />

                <footer className="reader-footer-nav">
                  {prevNext.prev ? (
                    <button
                      type="button"
                      className="footer-nav-btn"
                      onClick={() => navigateGuide(guide.moduleId, prevNext.prev!.file)}
                    >
                      <ChevronLeft size={16} />
                      <div>
                        <span className="footer-nav-label">Previous</span>
                        <span className="footer-nav-title">{prevNext.prev.title}</span>
                      </div>
                    </button>
                  ) : (
                    <div />
                  )}
                  {prevNext.next && (
                    <button
                      type="button"
                      className="footer-nav-btn next"
                      onClick={() => navigateGuide(guide.moduleId, prevNext.next!.file)}
                    >
                      <div>
                        <span className="footer-nav-label">Next</span>
                        <span className="footer-nav-title">{prevNext.next.title}</span>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  )}
                </footer>
              </>
            )}
          </main>

          <aside className="reader-toc">
            <div className="toc-title">On This Page</div>
            <nav className="toc-list" aria-label="Table of contents">
              {guide?.toc.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`toc-item level-${item.level} ${
                    activeHeading === item.id ? 'active' : ''
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                    setActiveHeading(item.id);
                  }}
                >
                  {item.text}
                </a>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectResult={(mId, fName, secId) => navigateGuide(mId, fName, secId)}
      />
    </div>
  );
}
