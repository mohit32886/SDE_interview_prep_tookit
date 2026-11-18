export interface GuideSummary {
  file: string;
  title: string;
  mermaidCount: number;
  svgCount: number;
  lineCount: number;
  readingMinutes: number;
}

export interface ModuleInfo {
  id: string;
  number: string;
  shortTitle: string;
  badge: string;
  accent: string;
  description: string;
  totalLines: number;
  totalMermaid: number;
  totalSvgs: number;
  assets: string[];
  previewSvg: string | null;
  guides: GuideSummary[];
}

export interface TocItem {
  level: number;
  text: string;
  id: string;
}

export interface GuideDetail {
  moduleId: string;
  file: string;
  title: string;
  toc: TocItem[];
  mermaidCount: number;
  svgCount: number;
  lineCount: number;
  readingMinutes: number;
  content: string;
}

export interface SearchResult {
  moduleId: string;
  moduleTitle: string;
  accent: string;
  file: string;
  guideTitle: string;
  section: string;
  sectionId: string;
  snippet: string;
  isHeading: boolean;
}

export type ConfidenceLevel = 'review' | 'shaky' | 'ready';
export type FlashcardRating = 'again' | 'hard' | 'good';

export interface FlashcardItem {
  id: string;
  moduleId: string;
  moduleTitle: string;
  accent: string;
  file: string;
  guideTitle: string;
  question: string;
  answer: string;
}

export interface MockSessionRecord {
  id: string;
  mode: string;
  promptTitle: string;
  score: number;
  maxScore: number;
  durationSec: number;
  date: string;
  notes: string;
}

export interface StudyProgress {
  completed: string[];
  bookmarks: string[];
  notes: Record<string, string>;
  confidence: Record<string, ConfidenceLevel>;
  flashcardRatings: Record<string, FlashcardRating>;
  mockHistory: MockSessionRecord[];
  lastVisited: { moduleId: string; file: string } | null;
}
