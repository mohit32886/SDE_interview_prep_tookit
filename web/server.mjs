import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const DIST_DIR = path.join(__dirname, 'dist');

const PORT = Number(process.env.PORT || (process.env.NODE_ENV === 'production' ? 3000 : 3001));

const MODULE_META = {
  '01-Java-Deep-Dive': {
    shortTitle: 'Java Deep Dive',
    badge: 'Core & JVM',
    accent: '#f97316',
    description: 'JVM internals, GC tuning, Concurrency, Streams, Collections, and Java 17–21 features.',
  },
  '02-Database-Deep-Dive': {
    shortTitle: 'Database Deep Dive',
    badge: 'SQL & ACID',
    accent: '#0ea5e9',
    description: 'B-Tree indexing, MVCC, isolation levels, query optimization, and sharding.',
  },
  '03-Design-Patterns-Deep-Dive': {
    shortTitle: 'Design Patterns',
    badge: 'LLD & OOD',
    accent: '#8b5cf6',
    description: 'SOLID principles, GoF patterns, real-world LLD case studies, and refactoring.',
  },
  '04-Microservices-Deep-Dive': {
    shortTitle: 'Microservices',
    badge: 'Distributed',
    accent: '#10b981',
    description: 'Saga, Outbox, Circuit Breakers, API Gateway, Service Discovery, and Observability.',
  },
  '05-Kafka-Deep-Dive': {
    shortTitle: 'Kafka Deep Dive',
    badge: 'Event Streaming',
    accent: '#eab308',
    description: 'Partitions, ISR, Consumer Groups, Exactly-Once Semantics, and Kafka Streams.',
  },
  '06-DSA-and-Coding': {
    shortTitle: 'DSA & Coding',
    badge: 'Algorithms',
    accent: '#ec4899',
    description: '15+ coding patterns, DP, Graphs, Trees, Sliding Window, and complexity cheatsheets.',
  },
  '07-System-Design-Fundamentals': {
    shortTitle: 'System Design',
    badge: 'HLD & Scale',
    accent: '#3b82f6',
    description: 'Back-of-envelope math, building blocks, and 10 production HLD case studies.',
  },
  '08-Behavioral-Interview-Prep': {
    shortTitle: 'Behavioral Prep',
    badge: 'STAR & LPs',
    accent: '#14b8a6',
    description: 'STAR pacing, Amazon 16 LPs, FAANG culture rubrics, story bank, and tough prompts.',
  },
  '09-Spring-Boot-Deep-Dive': {
    shortTitle: 'Spring Boot',
    badge: 'Enterprise Java',
    accent: '#22c55e',
    description: 'IoC & Bean lifecycle, Auto-Configuration, MVC, JPA/Hibernate, Security, and Testing.',
  },
  '10-MongoDB-Deep-Dive': {
    shortTitle: 'MongoDB',
    badge: 'NoSQL',
    accent: '#06b6d4',
    description: 'BSON/WiredTiger, Aggregation pipelines, ESR indexing, Replica Sets, and Sharding.',
  },
  '11-Machine-Coding-and-LLD': {
    shortTitle: 'Machine Coding & LLD',
    badge: 'Runnable Java',
    accent: '#f43f5e',
    description: '75-minute LLD playbook, Parking Lot, Splitwise, LRU Cache, Rate Limiter, Elevator & Task Scheduler.',
  },
  '12-Redis-and-Distributed-Caching': {
    shortTitle: 'Redis & Caching',
    badge: 'In-Memory',
    accent: '#ef4444',
    description: 'Event loop, SDS/SkipList/HyperLogLog, stampede/avalanche defense, Cluster 16K slots & RDB/AOF.',
  },
  '13-Cloud-Kubernetes-and-AI-Backend': {
    shortTitle: 'Cloud, K8s & AI/RAG',
    badge: 'Ops & GenAI',
    accent: '#6366f1',
    description: 'K8s probes & graceful SIGTERM, AWS SQS/MSK/DynamoDB tradeoffs, and RAG + pgvector + SSE.',
  },
};

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function extractTitle(content, fallback) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/-/g, ' ');
}

function extractToc(content) {
  const lines = content.split('\n');
  const toc = [];
  let inCode = false;
  const slugCounts = new Map();

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const rawText = match[2].trim();
      const text = rawText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_]/g, '');
      const baseSlug = slugifyHeading(text);
      const count = slugCounts.get(baseSlug) || 0;
      slugCounts.set(baseSlug, count + 1);
      const id = count === 0 ? baseSlug : `${baseSlug}-${count}`;
      toc.push({ level, text, id });
    }
  }
  return toc;
}

function countPatterns(content) {
  const mermaidCount = (content.match(/```mermaid/g) || []).length;
  const svgMatches = content.match(/\.\/assets\/[A-Za-z0-9_.-]+\.svg/g) || [];
  const lineCount = content.split('\n').length;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const readingMinutes = Math.max(1, Math.round(wordCount / 220));
  return { mermaidCount, svgCount: svgMatches.length, lineCount, readingMinutes };
}

async function getModulesIndex() {
  const entries = await fs.readdir(REPO_ROOT, { withFileTypes: true });
  const moduleDirs = entries
    .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
    .map((e) => e.name)
    .sort();

  const modules = [];
  for (const dirName of moduleDirs) {
    const modPath = path.join(REPO_ROOT, dirName);
    const modEntries = await fs.readdir(modPath, { withFileTypes: true });
    const mdFiles = modEntries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort((a, b) => {
        if (a === 'README.md') return -1;
        if (b === 'README.md') return 1;
        return a.localeCompare(b);
      });

    let totalLines = 0;
    let totalMermaid = 0;
    let totalSvgs = 0;
    const guides = [];

    for (const file of mdFiles) {
      const filePath = path.join(modPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const title = extractTitle(content, file);
      const stats = countPatterns(content);
      totalLines += stats.lineCount;
      totalMermaid += stats.mermaidCount;
      totalSvgs += stats.svgCount;
      guides.push({
        file,
        title,
        ...stats,
      });
    }

    let assets = [];
    try {
      const assetsDir = path.join(modPath, 'assets');
      const assetEntries = await fs.readdir(assetsDir);
      assets = assetEntries.filter((f) => f.endsWith('.svg')).sort();
    } catch {
      assets = [];
    }

    const meta = MODULE_META[dirName] || {
      shortTitle: dirName.replace(/^\d+-/, '').replace(/-/g, ' '),
      badge: 'Module',
      accent: '#3b82f6',
      description: '',
    };

    modules.push({
      id: dirName,
      number: dirName.slice(0, 2),
      ...meta,
      totalLines,
      totalMermaid,
      totalSvgs,
      assets,
      previewSvg: assets[0] ? `/api/assets/${encodeURIComponent(dirName)}/${encodeURIComponent(assets[0])}` : null,
      guides,
    });
  }
  return modules;
}

async function readProgress() {
  try {
    const raw = await fs.readFile(PROGRESS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { completed: [], bookmarks: [], notes: {}, lastVisited: null };
  }
}

async function writeProgress(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/modules', async (_req, res) => {
  try {
    const modules = await getModulesIndex();
    res.json({ modules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/guide', async (req, res) => {
  try {
    const moduleId = String(req.query.module || '');
    const file = String(req.query.file || 'README.md');
    if (!/^\d{2}-[A-Za-z0-9_-]+$/.test(moduleId) || !/^[A-Za-z0-9_.-]+\.md$/.test(file)) {
      return res.status(400).json({ error: 'Invalid module or file parameter' });
    }
    const targetPath = path.resolve(REPO_ROOT, moduleId, file);
    if (!targetPath.startsWith(REPO_ROOT)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const rawContent = await fs.readFile(targetPath, 'utf-8');
    const rewrittenContent = rawContent.replace(
      /\.\/assets\/([A-Za-z0-9_.-]+\.svg)/g,
      (_, asset) => `/api/assets/${encodeURIComponent(moduleId)}/${encodeURIComponent(asset)}`
    );
    const title = extractTitle(rawContent, file);
    const toc = extractToc(rawContent);
    const stats = countPatterns(rawContent);

    res.json({
      moduleId,
      file,
      title,
      toc,
      ...stats,
      content: rewrittenContent,
    });
  } catch (err) {
    res.status(404).json({ error: `Guide not found: ${err.message}` });
  }
});

app.get('/api/assets/:module/:asset', async (req, res) => {
  try {
    const { module: moduleId, asset } = req.params;
    if (!/^\d{2}-[A-Za-z0-9_-]+$/.test(moduleId) || !/^[A-Za-z0-9_.-]+\.svg$/.test(asset)) {
      return res.status(400).send('Invalid asset path');
    }
    const assetPath = path.resolve(REPO_ROOT, moduleId, 'assets', asset);
    if (!assetPath.startsWith(REPO_ROOT)) {
      return res.status(403).send('Forbidden');
    }
    const svg = await fs.readFile(assetPath, 'utf-8');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch {
    res.status(404).send('SVG not found');
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ results: [] });
    }
    const qLower = q.toLowerCase();
    const modules = await getModulesIndex();
    const results = [];

    for (const mod of modules) {
      for (const guide of mod.guides) {
        const filePath = path.join(REPO_ROOT, mod.id, guide.file);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        let currentSection = guide.title;
        let currentSectionId = '';
        let hitsInGuide = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
          if (headingMatch) {
            currentSection = headingMatch[1].replace(/[`*_]/g, '').trim();
            currentSectionId = slugifyHeading(currentSection);
          }
          if (line.toLowerCase().includes(qLower)) {
            const cleanSnippet = line
              .replace(/[#>*`]/g, '')
              .trim()
              .slice(0, 160);
            if (!cleanSnippet) continue;
            results.push({
              moduleId: mod.id,
              moduleTitle: mod.shortTitle,
              accent: mod.accent,
              file: guide.file,
              guideTitle: guide.title,
              section: currentSection,
              sectionId: currentSectionId,
              snippet: cleanSnippet,
              isHeading: Boolean(headingMatch),
            });
            hitsInGuide++;
            if (hitsInGuide >= 3) break;
          }
        }
        if (results.length >= 40) break;
      }
      if (results.length >= 40) break;
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress', async (_req, res) => {
  const progress = await readProgress();
  res.json(progress);
});

app.post('/api/progress', async (req, res) => {
  try {
    const current = await readProgress();
    const body = req.body || {};
    const next = {
      completed: Array.isArray(body.completed) ? body.completed : current.completed,
      bookmarks: Array.isArray(body.bookmarks) ? body.bookmarks : current.bookmarks,
      notes: body.notes && typeof body.notes === 'object' ? body.notes : current.notes,
      lastVisited: body.lastVisited !== undefined ? body.lastVisited : current.lastVisited,
    };
    await writeProgress(next);
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`SDE Interview Prep API running at http://localhost:${PORT}`);
});
