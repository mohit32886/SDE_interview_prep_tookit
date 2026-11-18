import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Timer,
} from 'lucide-react';
import type { MockSessionRecord, ModuleInfo } from '../types';

interface MockInterviewViewProps {
  modules: ModuleInfo[];
  history: MockSessionRecord[];
  onSaveSession: (record: MockSessionRecord) => void;
  onOpenGuide: (moduleId: string, file: string) => void;
}

interface RoundConfig {
  id: string;
  label: string;
  minutes: number;
  moduleIds: string[];
  phases: Array<{ label: string; pct: number }>;
  rubric: string[];
}

const ROUNDS: RoundConfig[] = [
  {
    id: 'hld',
    label: 'System Design (HLD · 45m)',
    minutes: 45,
    moduleIds: ['07-System-Design-Fundamentals', '12-Redis-and-Distributed-Caching', '13-Cloud-Kubernetes-and-AI-Backend'],
    phases: [
      { label: 'Clarify Scope', pct: 12 },
      { label: 'Back-of-Envelope', pct: 12 },
      { label: 'High-Level Design', pct: 32 },
      { label: 'Deep Dive Bottlenecks', pct: 32 },
      { label: 'Trade-offs & Failures', pct: 12 },
    ],
    rubric: [
      'Clarified functional & non-functional requirements (scale, latency, consistency) upfront',
      'Estimated QPS, storage, and bandwidth cleanly without getting stuck',
      'Drew clear end-to-end architecture with APIs, data model, and storage choices',
      'Went deep on 2–3 critical bottlenecks (sharding, caching, idempotency, concurrency)',
      'Articulated concrete trade-offs, failure modes, and monitoring/alerting',
    ],
  },
  {
    id: 'lld',
    label: 'Machine Coding / LLD (75m)',
    minutes: 75,
    moduleIds: ['11-Machine-Coding-and-LLD', '03-Design-Patterns-Deep-Dive'],
    phases: [
      { label: 'Entities & Scope', pct: 14 },
      { label: 'Interfaces & SOLID', pct: 14 },
      { label: 'Core Logic + Locks', pct: 46 },
      { label: 'Driver & Unit Tests', pct: 20 },
      { label: 'Extensibility', pct: 6 },
    ],
    rubric: [
      'Clarified edge cases and scoped an MVP before coding',
      'Defined clean interfaces and applied Strategy/Factory/Observer appropriately',
      'Handled concurrency safely (ReentrantLock, ConcurrentHashMap, Atomic types)',
      'Wrote clean, modular code with custom exceptions and zero God-classes',
      'Demonstrated runnable driver / JUnit tests and easy extensibility',
    ],
  },
  {
    id: 'dsa',
    label: 'DSA & Coding (45m)',
    minutes: 45,
    moduleIds: ['06-DSA-and-Coding'],
    phases: [
      { label: 'Clarify & Examples', pct: 15 },
      { label: 'Brute → Optimal', pct: 25 },
      { label: 'Clean Code', pct: 40 },
      { label: 'Dry Run & Edge Cases', pct: 20 },
    ],
    rubric: [
      'Confirmed constraints, input bounds, and edge cases before coding',
      'Identified optimal pattern and explained time/space complexity clearly',
      'Wrote bug-free, readable code while thinking aloud',
      'Manually dry-ran non-trivial and edge-case inputs line by line',
      'Handled follow-up scale/variant cleanly',
    ],
  },
  {
    id: 'behavioral',
    label: 'Behavioral & LPs (30m)',
    minutes: 30,
    moduleIds: ['08-Behavioral-Interview-Prep'],
    phases: [
      { label: 'Situation (15%)', pct: 15 },
      { label: 'Task (10%)', pct: 10 },
      { label: 'Action (55%)', pct: 55 },
      { label: 'Result + Learn (20%)', pct: 20 },
    ],
    rubric: [
      'Kept Situation + Task crisp (~25% of story) without over-explaining background',
      'Used "I" ownership instead of "we" in Action (~55% of story)',
      'Quantified Result with real metrics (latency, revenue, incidents, velocity)',
      'Showed blameless ownership and concrete lessons on failure/conflict probes',
      'Asked thoughtful, role-specific reverse questions',
    ],
  },
];

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MockInterviewView({
  modules,
  history,
  onSaveSession,
  onOpenGuide,
}: MockInterviewViewProps) {
  const [roundId, setRoundId] = useState<string>('hld');
  const round = useMemo(() => ROUNDS.find((r) => r.id === roundId) || ROUNDS[0], [roundId]);

  const candidates = useMemo(() => {
    const list: Array<{ moduleId: string; file: string; title: string }> = [];
    for (const m of modules) {
      if (!round.moduleIds.includes(m.id)) continue;
      for (const g of m.guides) {
        if (g.file === 'README.md') continue;
        list.push({ moduleId: m.id, file: g.file, title: g.title });
      }
    }
    return list;
  }, [modules, round]);

  const [prompt, setPrompt] = useState<{ moduleId: string; file: string; title: string } | null>(
    null
  );
  const [secondsLeft, setSecondsLeft] = useState(round.minutes * 60);
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<boolean[]>(() => round.rubric.map(() => false));
  const [notes, setNotes] = useState('');
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    setRunning(false);
    setSecondsLeft(round.minutes * 60);
    setChecks(round.rubric.map(() => false));
    setPrompt(candidates[0] || null);
    setSavedBanner(false);
  }, [round, candidates]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const pickRandomPrompt = () => {
    if (!candidates.length) return;
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    setPrompt(next);
    setSavedBanner(false);
  };

  const elapsedPct = Math.min(
    100,
    Math.round(((round.minutes * 60 - secondsLeft) / (round.minutes * 60)) * 100)
  );

  const handleSave = () => {
    const score = checks.filter(Boolean).length;
    onSaveSession({
      id: `${Date.now()}`,
      mode: round.label,
      promptTitle: prompt?.title || round.label,
      score,
      maxScore: round.rubric.length,
      durationSec: round.minutes * 60 - secondsLeft,
      date: new Date().toLocaleDateString(),
      notes,
    });
    setSavedBanner(true);
    setRunning(false);
  };

  return (
    <main className="studio-mode-main">
      <div className="mode-header">
        <div>
          <div className="hero-eyebrow">Timed Simulation · Self-Scoring Rubric</div>
          <h1>Mock Interview Simulator</h1>
          <p>Pick a round, draw a random prompt, pace yourself by phase, and score your execution.</p>
        </div>
      </div>

      <div className="mock-round-tabs">
        {ROUNDS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`action-pill ${roundId === r.id ? 'active-accent' : ''}`}
            onClick={() => setRoundId(r.id)}
          >
            <Timer size={14} />
            {r.label}
          </button>
        ))}
      </div>

      <div className="mock-grid">
        <section className="mock-card">
          <div className="mock-timer-display">
            <span className={`timer-digits ${secondsLeft < 300 ? 'timer-urgent' : ''}`}>
              {formatTime(secondsLeft)}
            </span>
            <div className="timer-controls">
              <button
                type="button"
                className="primary-btn"
                onClick={() => setRunning((v) => !v)}
              >
                {running ? <Pause size={16} /> : <Play size={16} />}
                {running ? 'Pause' : 'Start Timer'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setRunning(false);
                  setSecondsLeft(round.minutes * 60);
                }}
              >
                <RotateCcw size={15} /> Reset
              </button>
            </div>
          </div>

          <div className="pacing-bar-wrap">
            <div className="pacing-segments">
              {round.phases.map((p) => (
                <div key={p.label} className="pacing-seg" style={{ width: `${p.pct}%` }}>
                  <span>{p.label}</span>
                </div>
              ))}
            </div>
            <div className="module-progress-bar">
              <div className="module-progress-fill" style={{ width: `${elapsedPct}%` }} />
            </div>
          </div>

          <div className="mock-prompt-box">
            <div className="mock-prompt-head">
              <span>Assigned Prompt</span>
              <button type="button" className="icon-btn" onClick={pickRandomPrompt}>
                <Shuffle size={14} /> Randomize
              </button>
            </div>
            <h3>{prompt?.title || 'Select a round to draw a prompt'}</h3>
            {prompt && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => onOpenGuide(prompt.moduleId, prompt.file)}
              >
                <BookOpen size={15} /> Open Solution Guide (After Attempt)
              </button>
            )}
          </div>
        </section>

        <section className="mock-card">
          <h3>Interview Self-Scoring Rubric</h3>
          <div className="rubric-list">
            {round.rubric.map((item, idx) => (
              <label key={item} className="rubric-item">
                <input
                  type="checkbox"
                  checked={checks[idx] || false}
                  onChange={(e) => {
                    const next = [...checks];
                    next[idx] = e.target.checked;
                    setChecks(next);
                  }}
                />
                <span>{item}</span>
              </label>
            ))}
          </div>

          <div className="notes-drawer">
            <label htmlFor="mock-session-notes">Post-Mock Reflection (What to tighten next time?)</label>
            <textarea
              id="mock-session-notes"
              rows={3}
              placeholder="e.g., Forgot to discuss fencing tokens or spent too long on schema..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="mock-save-row">
            <span className="mock-score-badge">
              Score: {checks.filter(Boolean).length} / {round.rubric.length}
            </span>
            <button type="button" className="primary-btn" onClick={handleSave}>
              <CheckCircle2 size={16} /> Save Mock Session
            </button>
          </div>
          {savedBanner && <div className="saved-toast">Session saved to your Mock History!</div>}
        </section>
      </div>

      {history.length > 0 && (
        <section className="mock-history-card">
          <h3>Recent Mock Sessions</h3>
          <div className="mock-history-list">
            {history.slice(0, 6).map((h) => (
              <div key={h.id} className="mock-history-item">
                <div>
                  <strong>{h.promptTitle}</strong>
                  <span className="mock-hist-meta">
                    {h.mode} · {h.date} · {Math.round(h.durationSec / 60)}m elapsed
                  </span>
                </div>
                <span className="mock-score-badge">
                  {h.score}/{h.maxScore}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
