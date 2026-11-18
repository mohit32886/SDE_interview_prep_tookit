import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Check, Copy, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';

interface MermaidCardProps {
  code: string;
  isDark: boolean;
}

let renderCounter = 0;

export function MermaidCard({ code, isDark }: MermaidCardProps) {
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    const renderDiagram = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
        });
        const id = `mmd-${++renderCounter}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvgHtml(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
        }
      }
    };
    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [code, isDark]);

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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="mermaid-card">
      <div className="mermaid-toolbar">
        <span className="mermaid-badge">Interactive Diagram</span>
        <div className="mermaid-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
            title="Zoom out"
            aria-label="Zoom out diagram"
          >
            <ZoomOut size={14} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setZoom((z) => Math.min(2.2, +(z + 0.15).toFixed(2)))}
            title="Zoom in"
            aria-label="Zoom in diagram"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setZoom(1)}
            title="Reset zoom"
            aria-label="Reset diagram zoom"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={handleCopy}
            title="Copy Mermaid source"
            aria-label="Copy Mermaid source"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => dialogRef.current?.showModal()}
            title="Expand diagram"
            aria-label="Expand diagram"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {error ? (
        <pre className="mermaid-fallback">
          <code>{code}</code>
        </pre>
      ) : (
        <div className="mermaid-viewport">
          <div
            className="mermaid-canvas"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="lightbox-dialog"
        aria-labelledby={titleId}
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="lightbox-header">
          <h3 id={titleId}>Diagram Preview</h3>
          <button
            type="button"
            className="icon-btn"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close diagram preview"
          >
            <X size={18} />
          </button>
        </div>
        <div className="lightbox-body" dangerouslySetInnerHTML={{ __html: svgHtml }} />
      </dialog>
    </div>
  );
}
