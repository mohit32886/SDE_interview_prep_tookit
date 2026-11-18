import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Bookmark,
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
  X,
} from 'lucide-react';
import type { GuideDetail, ModuleInfo, StudyProgress } from './types';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { SearchDialog } from './components/SearchDialog';

type ThemePref = 'light dark' | 'light' | 'dark';

function resolveIsDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function parseRoute(): { moduleId?: string; file?: string; sectionId?: string } {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!hash || hash === '/') return {};
  const [pathPart, sectionId] = hash.split('#');
  const parts = pathPart.split('/').filter(Boolean);
  if (parts[0] === 'guide' && parts[1]) {
    return {
      moduleId: decodeURIComponent(parts[1]),
      file: parts[2] ? decodeURIComponent(parts[2]) : 'README.md',
      sectionId,
    };
  }
  return {};
}

export function App() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);
  const [route, setRoute] = useState(parseRoute);
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

  // Cross-tab color-scheme sync
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

  // Load modules & persisted study progress
  useEffect(() => {
    Promise.all([
      fetch('/api/modules').then((r) => r.json()),
      fetch('/api/progress').then((r) => r.json()),
    ])
      .then(([modData, progData]) => {
        setModules(modData.modules || []);
        if (progData) setProgress(progData);
      })
      .finally(() => setLoadingModules(false));
  }, []);

  // Hash routing
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Global Cmd+K / '/' shortcut for SearchDialog
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

  // Fetch active guide
  useEffect(() => {
    if (!route.moduleId || !route.file) {
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
  }, [route.moduleId, route.file, route.sectionId]);

  // Scroll-spy for TOC
  useEffect(() => {
    if (!guide?.toc?.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHeading(entry.target.id);
          }
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
  const isCompleted = guideKey ? progress.completed.includes(guideKey) : false;
  const isBookmarked = guideKey ? progress.bookmarks.includes(guideKey) : false;

  const toggleCompleted = () => {
    if (!guideKey) return;
    const completed = isCompleted
      ? progress.completed.filter((k) => k !== guideKey)
      : [...progress.completed, guideKey];
    persistProgress({ ...progress, completed });
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
          {route.moduleId && (
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
        </div>

        <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          <span>Search guides, diagrams, Q&amp;As...</span>
          <kbd>⌘K</kbd>
        </button>

        <div className="nav-right">
          <div className="progress-pill" title="Overall study progress">
            <CheckCircle2 size={14} />
            <span>
              {progress.completed.length}/{totalStats.guides || 0} done
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

      {!route.moduleId ? (
        <main className="dashboard-main">
          <section className="hero-banner">
            <div className="hero-content">
              <div className="hero-eyebrow">10-Module Visual Interview Toolkit</div>
              <h1>Master Backend, System Design &amp; FAANG Interviews Visually</h1>
              <p>
                Interactive Mermaid architecture diagrams, animated SVG flows, syntax-highlighted
                production code, and progress tracking—powered directly by your Markdown study
                repository.
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
                <button type="button" className="secondary-btn" onClick={() => setSearchOpen(true)}>
                  <Search size={16} />
                  Quick Search (⌘K)
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
              <div className="loading-grid">Loading 10 modules...</div>
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
                          {doneCount}/{mod.guides.length} completed
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
                <ChevronLeft size={15} /> All 10 Modules
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
                const done = progress.completed.includes(`${activeModule.id}/${g.file}`);
                return (
                  <button
                    key={g.file}
                    type="button"
                    className={`sidebar-guide-item ${isActive ? 'active' : ''}`}
                    onClick={() => navigateGuide(activeModule.id, g.file)}
                  >
                    <span className="guide-status-icon">
                      {done ? <CheckCircle2 size={15} className="done-icon" /> : <Circle size={15} />}
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
                    <button
                      type="button"
                      className={`action-pill ${isCompleted ? 'active-success' : ''}`}
                      onClick={toggleCompleted}
                    >
                      <CheckCircle2 size={15} />
                      {isCompleted ? 'Completed' : 'Mark Complete'}
                    </button>
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
