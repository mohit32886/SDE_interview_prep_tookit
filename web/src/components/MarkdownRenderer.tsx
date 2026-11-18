import { useEffect, useMemo, useRef, useState } from 'react';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { MermaidCard } from './MermaidCard';
import { X } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  isDark: boolean;
  onNavigateFile?: (file: string) => void;
}

type Segment =
  | { type: 'markdown'; value: string }
  | { type: 'mermaid'; value: string };

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitMermaidBlocks(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```mermaid\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'markdown', value: markdown.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'mermaid', value: match[1].trim() });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < markdown.length) {
    segments.push({ type: 'markdown', value: markdown.slice(lastIndex) });
  }
  return segments;
}

const ALERT_TYPES: Record<string, { label: string; cls: string }> = {
  NOTE: { label: 'Note', cls: 'alert-note' },
  TIP: { label: 'Tip', cls: 'alert-tip' },
  IMPORTANT: { label: 'Important', cls: 'alert-important' },
  WARNING: { label: 'Warning', cls: 'alert-warning' },
  CAUTION: { label: 'Caution', cls: 'alert-caution' },
};

function renderMarkdownChunk(chunk: string, slugCounts: Map<string, number>): string {
  const markedInstance = new Marked({
    gfm: true,
    breaks: false,
  });

  markedInstance.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const plain = html.replace(/<[^>]+>/g, '');
        const base = slugifyHeading(plain);
        const count = slugCounts.get(base) || 0;
        slugCounts.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        return `<h${depth} id="${id}" class="md-heading"><a class="anchor-link" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang || 'text').trim().split(/\s+/)[0];
        let highlighted = escapeHtml(text);
        if (language && hljs.getLanguage(language)) {
          highlighted = hljs.highlight(text, { language }).value;
        } else if (language !== 'text') {
          highlighted = hljs.highlightAuto(text).value;
        }
        const encoded = btoa(unescape(encodeURIComponent(text)));
        return `<div class="code-block">
          <div class="code-header">
            <span class="code-lang">${escapeHtml(language)}</span>
            <button type="button" class="copy-code-btn" data-code="${encoded}">Copy</button>
          </div>
          <pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>
        </div>\n`;
      },
      table({ header, rows }) {
        const headerHtml = header
          .map((cell) => `<th scope="col">${this.parser.parseInline(cell.tokens)}</th>`)
          .join('');
        const bodyHtml = rows
          .map((row) => {
            const cells = row
              .map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`)
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('');
        return `<div tabindex="0" role="region" aria-label="Study comparison table" class="table-wrapper">
          <table>
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${bodyHtml}</tbody>
          </table>
        </div>\n`;
      },
      blockquote({ tokens }) {
        const inner = this.parser.parse(tokens);
        const alertMatch = inner.match(/^<p>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*)/i);
        if (alertMatch) {
          const kind = alertMatch[1].toUpperCase();
          const meta = ALERT_TYPES[kind] || ALERT_TYPES.NOTE;
          const rest = alertMatch[2].replace(/^\s*<br\s*\/?>\s*/i, '');
          const body = `<p>${rest}`;
          return `<div class="gh-alert ${meta.cls}" role="note">
            <div class="gh-alert-title">${meta.label}</div>
            <div class="gh-alert-body">${body}</div>
          </div>\n`;
        }
        return `<blockquote>${inner}</blockquote>\n`;
      },
      image({ href, title, text }) {
        if (href.endsWith('.svg')) {
          return `<figure class="svg-showcase">
            <div class="svg-showcase-bar">
              <span class="svg-badge">Animated Diagram</span>
              <span class="svg-caption">${escapeHtml(text || title || 'Interactive Architecture')}</span>
            </div>
            <button type="button" class="svg-zoom-trigger" data-svg-src="${escapeHtml(href)}" data-svg-alt="${escapeHtml(text || 'Diagram')}">
              <img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" loading="lazy" />
            </button>
          </figure>\n`;
        }
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" title="${escapeHtml(title || '')}" loading="lazy" />`;
      },
    },
  });

  const rawHtml = markedInstance.parse(chunk) as string;
  return DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['figure', 'figcaption', 'button'],
    ADD_ATTR: [
      'tabindex',
      'role',
      'aria-label',
      'aria-hidden',
      'scope',
      'data-code',
      'data-svg-src',
      'data-svg-alt',
      'loading',
      'type',
    ],
  });
}

export function MarkdownRenderer({ content, isDark, onNavigateFile }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgDialogRef = useRef<HTMLDialogElement>(null);
  const [previewSvg, setPreviewSvg] = useState<{ src: string; alt: string } | null>(null);

  const segments = useMemo(() => splitMermaidBlocks(content), [content]);

  const renderedSegments = useMemo(() => {
    const slugCounts = new Map<string, number>();
    return segments.map((seg) =>
      seg.type === 'mermaid'
        ? seg
        : { type: 'html' as const, value: renderMarkdownChunk(seg.value, slugCounts) }
    );
  }, [segments]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      const copyBtn = target.closest('.copy-code-btn') as HTMLButtonElement | null;
      if (copyBtn) {
        const encoded = copyBtn.getAttribute('data-code') || '';
        try {
          const decoded = decodeURIComponent(escape(atob(encoded)));
          await navigator.clipboard.writeText(decoded);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
          }, 1600);
        } catch {
          copyBtn.textContent = 'Error';
        }
        return;
      }

      const svgBtn = target.closest('.svg-zoom-trigger') as HTMLButtonElement | null;
      if (svgBtn) {
        const src = svgBtn.getAttribute('data-svg-src');
        const alt = svgBtn.getAttribute('data-svg-alt') || 'Animated Diagram';
        if (src) {
          setPreviewSvg({ src, alt });
          svgDialogRef.current?.showModal();
        }
        return;
      }

      const anchor = target.closest('a') as HTMLAnchorElement | null;
      if (anchor && onNavigateFile) {
        const href = anchor.getAttribute('href') || '';
        if (href.endsWith('.md') && !href.startsWith('http')) {
          event.preventDefault();
          onNavigateFile(href.replace(/^\.\//, ''));
        }
      }
    };

    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [onNavigateFile]);

  // Safari fallback for <dialog closedby="any">
  useEffect(() => {
    const dialog = svgDialogRef.current;
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

  return (
    <div ref={containerRef} className="markdown-body">
      {renderedSegments.map((seg, idx) =>
        seg.type === 'mermaid' ? (
          <MermaidCard key={`mmd-${idx}`} code={seg.value} isDark={isDark} />
        ) : (
          <div key={`html-${idx}`} dangerouslySetInnerHTML={{ __html: seg.value }} />
        )
      )}

      <dialog
        ref={svgDialogRef}
        className="lightbox-dialog"
        aria-labelledby="svg-lightbox-title"
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="lightbox-header">
          <h3 id="svg-lightbox-title">{previewSvg?.alt || 'Animated Diagram'}</h3>
          <button
            type="button"
            className="icon-btn"
            onClick={() => svgDialogRef.current?.close()}
            aria-label="Close diagram"
          >
            <X size={18} />
          </button>
        </div>
        {previewSvg && (
          <div className="lightbox-body svg-lightbox-body">
            <img src={previewSvg.src} alt={previewSvg.alt} />
          </div>
        )}
      </dialog>
    </div>
  );
}
