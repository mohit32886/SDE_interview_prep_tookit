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

export interface StudyProgress {
  completed: string[];
  bookmarks: string[];
  notes: Record<string, string>;
  lastVisited: { moduleId: string; file: string } | null;
}
