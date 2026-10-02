// ============================================================================
// /profile — a member's own account settings: nickname, avatar color, and
// changing their password. Kept separate from My Team (which is about the
// favorite-team personalization, not identity), so account actions have one
// obvious home. Reachable by anyone signed in — accountGate() in app.js
// already guarantees account.getAccount() is non-null by the time this
// renders, but it's checked again here defensively.
// ============================================================================

import { h, card, avatarInitial, emptyState, toast } from '../components.js';
import { AVATAR_HUES } from '../format.js';
import * as account from '../account.js';
import { t as tt } from '../i18n.js';

function fieldLabel(text) {
  return h('label', { style: 'font-size:11.5px;font-weight:700;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em;margin-top:10px;display:block' }, text);
}

function avatarSection(acc, onSaved) {
  const preview = h('div', { style: 'display:flex;justify-content:center;margin-bottom:14px' }, [avatarInitial(acc.nickname, 64, acc.avatarColor)]);
  const swatchRow = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center' });
  function paintSwatches() {
    swatchRow.innerHTML = '';
    AVATAR_HUES.forEach(color => {
      const isActive = acc.avatarColor === color;
      const swatch = h('button', {
        title: color,
        style: `width:30px;height:30px;border-radius:50%;background:${color};border:2px solid ${isActive ? 'var(--accent-2)' : 'transparent'};box-shadow:0 0 0 1px var(--line);cursor:pointer;padding:0`,
        onclick: async () => {
          acc.avatarColor = color;
          await account.updateAvatarColor(color);
          preview.innerHTML = '';
          preview.appendChild(avatarInitial(acc.nickname, 64, acc.avatarColor));
          paintSwatches();
          onSaved();
        },
      });
      swatchRow.appendChild(swatch);
    });
  }
  paintSwatches();
  return card([
    h('div', { style: 'text-align:center' }, [
      h('div', { style: 'font-size:11.5px;font-weight:700;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px' }, tt('profile.avatarLabel')),
      preview,
      swatchRow,
    ]),
  ], { title: tt('profile.avatarHeading') });
}

function nicknameSection(acc, onSaved) {
  const input = h('input', {
    class: 'gate-input', type: 'text', maxlength: '24', value: acc.nickname,
    style: 'width:220px;max-width:100%',
  });
  const saveBtn = h('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:10px' }, tt('profile.saveNickname'));
  async function save() {
    const val = input.value.trim();
    if (!val || val === acc.nickname) return;
    saveBtn.disabled = true;
    await account.updateNickname(val);
    toast(tt('profile.nicknameSaved'));
    onSaved();
  }
  saveBtn.addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  return card([
    fieldLabel(tt('profile.nicknameLabel')),
    input,
    saveBtn,
  ], { title: tt('profile.nicknameHeading') });
}

function passwordSection() {
  const currentInput = h('input', { class: 'gate-input', type: 'password', autocomplete: 'current-password' });
  const newInput = h('input', { class: 'gate-input', type: 'password', autocomplete: 'new-password' });
  const confirmInput = h('input', { class: 'gate-input', type: 'password', autocomplete: 'new-password' });
  const errEl = h('div', { style: 'color:var(--critical);font-size:12.5px;min-height:16px;margin-top:6px' });
  const saveBtn = h('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:4px' }, tt('profile.changePasswordCta'));
  async function save() {
    errEl.textContent = '';
    if (!currentInput.value) { errEl.textContent = tt('profile.currentPasswordRequired'); return; }
    if (newInput.value.length < 6) { errEl.textContent = tt('accountGate.passwordTooShort'); return; }
    if (newInput.value !== confirmInput.value) { errEl.textContent = tt('accountGate.passwordMismatch'); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = tt('accountGate.submitting');
    const res = await account.changePassword({ currentPassword: currentInput.value, newPassword: newInput.value });
    saveBtn.disabled = false;
    saveBtn.textContent = tt('profile.changePasswordCta');
    if (!res.ok) {
      errEl.textContent = res.error === 'wrong_password' ? tt('profile.wrongCurrentPassword') : tt('accountGate.genericError');
      return;
    }
    currentInput.value = ''; newInput.value = ''; confirmInput.value = '';
    toast(tt('profile.passwordChanged'));
  }
  saveBtn.addEventListener('click', save);
  [currentInput, newInput, confirmInput].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); }));
  return card([
    fieldLabel(tt('profile.currentPasswordLabel')),
    currentInput,
    fieldLabel(tt('profile.newPasswordLabel')),
    newInput,
    fieldLabel(tt('accountGate.confirmPasswordLabel')),
    confirmInput,
    errEl,
    saveBtn,
  ], { title: tt('profile.passwordHeading') });
}

export async function renderProfile(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  root.appendChild(wrap);

  const acc = account.getAccount();
  if (!acc) { wrap.appendChild(emptyState(tt('profile.noAccount'))); return; }

  wrap.appendChild(h('div', { style: 'margin-bottom:4px' }, [
    h('div', { class: 'eyebrow' }, tt('profile.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:4px;margin-bottom:14px' }, tt('profile.title', { name: acc.nickname })),
  ]));

  function refresh() { renderProfile(root); }

  wrap.appendChild(avatarSection(acc, refresh));
  wrap.appendChild(nicknameSection(acc, refresh));
  wrap.appendChild(passwordSection());

  wrap.appendChild(h('div', { style: 'text-align:center;margin-top:20px' }, [
    h('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => { account.signOutAccount(); window.dispatchEvent(new Event('hashchange')); },
    }, tt('profile.signOutCta')),
  ]));
}
