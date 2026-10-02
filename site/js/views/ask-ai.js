// ============================================================================
// Ask AI — a persistent-feeling side panel backed by the `sample` runtime
// capability (Claude, called directly from the published page). It answers
// ONLY from a compact, structured context snapshot of the current page,
// assembled by ai-context.js — never the raw multi-MB datasets. This keeps
// the model from ever "being the database" or inventing numbers.
// ============================================================================

import { h } from '../components.js';
import { getAIContext } from '../ai-context.js';
import { SEASON_LABELS } from '../data.js';
import { state } from '../state.js';
import { t, currentLang } from '../i18n.js';

let panelEl = null;
let capabilityChecked = false;
let sampleFn = null;

async function getSample() {
  if (capabilityChecked) return sampleFn;
  capabilityChecked = true;
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      sampleFn = await window.claude.use('sample');
    }
  } catch { sampleFn = null; }
  return sampleFn;
}

function systemPrompt(ctx) {
  const langInstruction = currentLang() === 'el' ? '\n\nRespond in Greek (Ελληνικά) — the user has the app set to Greek. Keep EuroLeague team names, player names, and stat abbreviations (PTS, AST, REB, etc.) as-is; write the surrounding sentences in Greek.' : '';
  return `You are the "AI Basketball Analyst" embedded inside BoxOut, a EuroLeague analytics app. The user is currently on: ${ctx.page} (${SEASON_LABELS[state.season]} season).

You may ONLY use numbers from the JSON context below — never invent, estimate, or recall a EuroLeague statistic from your own memory. If the context doesn't contain what's needed to answer, say so plainly in one sentence and name which app section would have it (Teams, Players, Compare Center, Data Explorer, or Analytics Lab).

Answer conversationally, under 130 words, citing specific numbers from the context. No markdown headers.${langInstruction}

CONTEXT:
${JSON.stringify(ctx.data)}`;
}

function bubble(role, text) {
  const isUser = role === 'user';
  return h('div', { style: `display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'}` }, [
    h('div', {
      style: `max-width:85%;padding:10px 13px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap;${isUser ? 'background:var(--accent);color:var(--ink-on-accent);border-bottom-right-radius:4px' : 'background:var(--surface-2);color:var(--ink);border:1px solid var(--line);border-bottom-left-radius:4px'}`,
    }, text),
  ]);
}

// Called on every route change so a panel left open while navigating shows
// the page the user is now looking at, not a stale label from before.
export function refreshAskAIHeader() {
  if (!panelEl) return;
  const label = panelEl.querySelector('[data-ai-page-label]');
  if (label) label.textContent = t('askai.lookingAt', { page: getAIContext().page });
}

export function toggleAskAI() {
  if (panelEl) { closeAskAI(); return; }
  openAskAI();
}

export function closeAskAI() {
  if (panelEl) { panelEl.remove(); panelEl = null; }
}

export function openAskAI() {
  if (panelEl) return;
  panelEl = h('div', {
    style: 'position:fixed;top:var(--topbar-h);right:0;bottom:0;width:380px;max-width:92vw;background:var(--surface-raised);border-left:1px solid var(--line);box-shadow:var(--shadow-lg);z-index:19;display:flex;flex-direction:column',
  });
  const header = h('div', { style: 'padding:16px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px' }, [
    h('span', { style: 'font-size:15px' }, '✦'),
    h('div', {}, [h('div', { style: 'font-weight:700;font-size:14px' }, t('askai.title')), h('div', { 'data-ai-page-label': 'true', style: 'font-size:11px;color:var(--ink-muted)' }, t('askai.lookingAt', { page: getAIContext().page }))]),
    h('button', { class: 'btn btn-icon btn-ghost', style: 'margin-left:auto', onclick: closeAskAI }, '✕'),
  ]);

  const messages = h('div', { style: 'flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px' });
  const inputRow = h('div', { style: 'padding:12px;border-top:1px solid var(--line);display:flex;gap:8px' });
  const input = h('input', { 'data-ai-input': 'true', placeholder: t('askai.inputPlaceholder'), style: 'flex:1;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font-size:13px' });
  const sendBtn = h('button', { class: 'btn btn-primary btn-sm' }, t('askai.send'));
  inputRow.appendChild(input); inputRow.appendChild(sendBtn);
  panelEl.appendChild(header); panelEl.appendChild(messages); panelEl.appendChild(inputRow);
  document.body.appendChild(panelEl);

  messages.appendChild(bubble('assistant', t('askai.greeting', { page: getAIContext().page })));

  async function send() {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    messages.appendChild(bubble('user', q));
    messages.scrollTop = messages.scrollHeight;
    const thinking = bubble('assistant', '…');
    messages.appendChild(thinking);
    messages.scrollTop = messages.scrollHeight;

    const sample = await getSample();
    if (!sample) {
      thinking.firstChild.textContent = t('askai.unavailable', { explorer: t('nav.explorer'), lab: t('nav.lab') });
      return;
    }
    try {
      const ctx = getAIContext();
      await sample(systemPrompt(ctx) + `\n\nUSER: ${q}`, {
        modelTier: 'quick',
        onText: ({ text }) => { thinking.firstChild.textContent = text || '…'; messages.scrollTop = messages.scrollHeight; },
      });
    } catch (err) {
      thinking.firstChild.textContent = err && err.code === 'not_granted'
        ? t('askai.declined', { explorer: t('nav.explorer'), lab: t('nav.lab') })
        : t('askai.error', { code: err && err.code || 'error' });
    }
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  setTimeout(() => input.focus(), 30);
}
