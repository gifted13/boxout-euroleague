// ============================================================================
// Content Creation Mode — turns any stat/insight into a shareable graphic
// (branded 1080x1080 PNG, canvas-rendered, no external deps) or plain text
// (clipboard), so a finding never has to be manually re-typed to share it.
// ============================================================================

import { h, openModal } from './components.js';
import { downloadSVGAsPNG, copyToClipboard } from './export.js';

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

function renderCardCanvas({ eyebrow, title, body, sourceNote, season }) {
  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0d0d10');
  grad.addColorStop(1, '#181a22');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // accent corner glow
  const glow = ctx.createRadialGradient(W - 100, 100, 20, W - 100, 100, 480);
  glow.addColorStop(0, 'rgba(232,169,61,0.35)');
  glow.addColorStop(1, 'rgba(232,169,61,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const pad = 88;
  // brand mark
  ctx.fillStyle = '#e8a93d';
  ctx.beginPath();
  ctx.arc(pad + 26, 84 + 26, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1030';
  ctx.font = '800 24px Georgia, serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('B', pad + 26, 84 + 28);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f5f5f2';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillText('BoxOut', pad + 68, 100);
  ctx.fillStyle = '#898781';
  ctx.font = '600 15px system-ui, sans-serif';
  ctx.fillText('EUROLEAGUE INTELLIGENCE', pad + 68, 124);

  // eyebrow badge
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = '#e8a93d';
  ctx.fillText((eyebrow || '').toUpperCase(), pad, 250);

  // title
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 56px system-ui, sans-serif';
  const titleLines = wrapText(ctx, title, W - pad * 2);
  let y = 320;
  titleLines.slice(0, 4).forEach(line => { ctx.fillText(line, pad, y); y += 64; });

  // body
  y += 20;
  ctx.fillStyle = '#c3c2b7';
  ctx.font = '400 28px system-ui, sans-serif';
  const bodyLines = wrapText(ctx, body, W - pad * 2);
  bodyLines.slice(0, 8).forEach(line => { ctx.fillText(line, pad, y); y += 40; });

  // footer
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.moveTo(pad, H - 140); ctx.lineTo(W - pad, H - 140); ctx.stroke();
  ctx.fillStyle = '#898781';
  ctx.font = '400 20px system-ui, sans-serif';
  ctx.fillText(sourceNote || '', pad, H - 100);
  ctx.fillText(`EuroLeague ${season || ''}`, pad, H - 68);

  return canvas;
}

export function openShareCard({ eyebrow, title, body, sourceNote, season }) {
  const canvas = renderCardCanvas({ eyebrow, title, body, sourceNote, season });
  const preview = h('div', { style: 'display:flex;justify-content:center' });
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.style.cssText = 'width:100%;max-width:360px;border-radius:12px;box-shadow:var(--shadow-md)';
  preview.appendChild(img);

  const shareText = `${title}\n\n${body}\n\n${sourceNote || ''}`.trim();

  const { close } = openModal({
    title: 'Share This Insight',
    body: [preview],
    footer: [
      h('button', { class: 'btn btn-sm', onclick: () => copyToClipboard(shareText) }, '⎘ Copy Caption Text'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        canvas.toBlob(async (blob) => {
          const { toast } = await import('./components.js');
          try {
            if (window.claude && typeof window.claude.use === 'function') {
              const downloads = await window.claude.use('downloads');
              if (downloads) { await downloads.save({ filename: 'euroleague-insight.png', data: blob }); toast('Saved euroleague-insight.png'); return; }
            }
          } catch { /* fall through to blob download */ }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'euroleague-insight.png';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          toast('Downloaded euroleague-insight.png');
        }, 'image/png');
      } }, '⤓ Download PNG'),
    ],
  });
  return { close };
}
