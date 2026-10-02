// ============================================================================
// /admin — BoxOut's control panel. Reachable ONLY by the one hardcoded
// super-admin account (account.ADMIN_EMAIL, see account.isSuperAdmin() in
// js/account.js) — not by anyone merely holding role: 'admin', which is now
// just a cosmetic badge the super admin can assign to any approved user
// from this panel. From here the super admin: approves or rejects pending
// access requests (choosing member/admin at approval time), can change any
// approved user's role at any time, can ban/unban or delete an approved
// account, and approves "forgot password" requests — approving only opens
// the door for the user to set their OWN new password (see
// account.adminApprovePasswordReset); the super admin never sees or types
// anyone else's password. Every document lives in the shared `requests`
// (and `password_resets`) collection — the same ones account.js
// reads/writes for the gate — so an action here reaches the requester's own
// tab live via their subscribeAccountStatus()/subscribePasswordResetStatus()
// subscriptions, no matter which device they're on.
//
// This page's own gate below (the isSuperAdmin() check that shows
// admin.notAuthorized) is only a UI-level convenience — it just hides the
// panel from someone who obviously isn't the super admin. The REAL
// enforcement lives in Firestore's security rules (firestore.rules): every
// approve/reject/ban/delete/role-change/reset-approve write from this page
// is checked server-side against a real, separately-authenticated Firebase
// Auth session for account.ADMIN_EMAIL (see account.syncSuperAdminAuth()),
// not against anything the browser merely claims about itself. So even a
// visitor who bypasses this page's UI entirely and calls the Firestore API
// by hand cannot perform any of these actions without that real login.
// ============================================================================

import { h, sectionHead, emptyState, skeletonCard, avatarInitial, toast, openModal } from '../components.js';
import { fmtDate, fmtDateTime } from '../format.js';
import { t as tt } from '../i18n.js';
import * as account from '../account.js';

function fmtWhen(ms) {
  if (!ms) return '';
  try { return fmtDate(ms); } catch { return ''; }
}
function fmtWhenTime(ms) {
  if (!ms) return '';
  try { return fmtDateTime(ms); } catch { return ''; }
}

export async function renderAdmin(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  root.appendChild(wrap);

  if (!account.isSuperAdmin()) {
    wrap.appendChild(emptyState(tt('admin.notAuthorized'), '⛊'));
    return;
  }
  const me = account.getAccount();

  wrap.appendChild(h('div', { class: 'trivia-hero' }, [
    h('div', { class: 'eyebrow' }, tt('admin.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:6px' }, tt('admin.title')),
    h('p', { style: 'font-size:13.5px;color:var(--ink-muted);max-width:480px;margin:8px auto 0' }, tt('admin.intro')),
  ]));

  wrap.appendChild(skeletonCard());

  const db = await account.getDb();
  if (!db) {
    wrap.innerHTML = '';
    wrap.appendChild(emptyState(tt('admin.dbUnavailable'), '⚠'));
    return;
  }

  const resetSection = h('div', {});
  const pendingSection = h('div', { style: 'margin-top:22px' });
  const approvedSection = h('div', { style: 'margin-top:22px' });
  const bannedSection = h('div', { style: 'margin-top:22px' });
  const rejectedSection = h('div', { style: 'margin-top:22px' });
  wrap.innerHTML = '';
  wrap.appendChild(h('div', { class: 'trivia-hero' }, [
    h('div', { class: 'eyebrow' }, tt('admin.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:6px' }, tt('admin.title')),
    h('p', { style: 'font-size:13.5px;color:var(--ink-muted);max-width:480px;margin:8px auto 0' }, tt('admin.intro')),
  ]));
  wrap.appendChild(resetSection);
  wrap.appendChild(pendingSection);
  wrap.appendChild(approvedSection);
  wrap.appendChild(bannedSection);
  wrap.appendChild(rejectedSection);

  let busyIds = new Set();

  // A row is normally a single flex line (avatar + info + actions); `extra`
  // — used for the pending list's role picker — stacks a second, full-width
  // block underneath it inside the same card.
  function personRow(rec, actions, extra) {
    const email = rec.email || '';
    const nickname = rec.nickname || email;
    const row = h('div', { style: 'display:flex;align-items:center;gap:12px' }, [
      avatarInitial(nickname, 36, rec.avatarColor),
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { style: 'font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap' }, [
          nickname,
          rec.role === 'admin' ? h('span', { class: 'badge', style: 'font-size:10px' }, tt('admin.adminBadge')) : null,
        ]),
        h('div', { style: 'font-size:12px;color:var(--ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, email),
        rec.favoriteTeamCode ? h('div', { style: 'font-size:11.5px;color:var(--ink-secondary);margin-top:2px' }, rec.favoriteTeamCode) : null,
        rec.requestedAt ? h('div', { style: 'font-size:11px;color:var(--ink-muted);margin-top:2px' }, tt('admin.requestedOn', { date: fmtWhen(rec.requestedAt) })) : null,
        rec.status === 'approved' || rec.status === 'banned'
          ? h('div', { style: 'font-size:11px;color:var(--ink-muted);margin-top:2px' }, rec.lastSeenAt ? tt('admin.lastSeenOn', { date: fmtWhenTime(rec.lastSeenAt) }) : tt('admin.lastSeenNever'))
          : null,
      ]),
      h('div', { style: 'display:flex;gap:6px;flex-shrink:0' }, actions),
    ]);
    const children = [row];
    if (extra) children.push(extra);
    return h('div', { class: 'card', style: 'margin-bottom:8px' }, children);
  }

  // Small segmented control for choosing the role a pending request gets
  // when approved. Returns { el, get } so the Approve handler can read the
  // current choice without a separate state variable per row.
  function roleToggle() {
    let role = 'member';
    const memberBtn = h('button', { class: 'active' }, tt('admin.roleMember'));
    const adminBtn = h('button', {}, tt('admin.roleAdmin'));
    function sync() { memberBtn.classList.toggle('active', role === 'member'); adminBtn.classList.toggle('active', role === 'admin'); }
    memberBtn.addEventListener('click', () => { role = 'member'; sync(); });
    adminBtn.addEventListener('click', () => { role = 'admin'; sync(); });
    const el = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:10px' }, [
      h('span', { style: 'font-size:11.5px;color:var(--ink-muted);font-weight:600' }, tt('admin.roleLabel')),
      h('div', { class: 'season-toggle', style: 'width:150px' }, [memberBtn, adminBtn]),
    ]);
    return { el, get: () => role };
  }

  // Same look as roleToggle() above, but for an ALREADY-approved user: it
  // reflects the user's current role and writes the change immediately
  // (via account.adminSetRole) instead of collecting a choice for later.
  // role is a cosmetic label only — see isSuperAdmin() in account.js — so
  // this never touches dashboard access, including the super admin's own.
  function roleChangeControl(rec) {
    let role = rec.role === 'admin' ? 'admin' : 'member';
    const memberBtn = h('button', { class: role === 'member' ? 'active' : '' }, tt('admin.roleMember'));
    const adminBtn = h('button', { class: role === 'admin' ? 'active' : '' }, tt('admin.roleAdmin'));
    function sync() { memberBtn.classList.toggle('active', role === 'member'); adminBtn.classList.toggle('active', role === 'admin'); }
    function choose(next) {
      if (role === next) return;
      const prev = role;
      role = next; sync();
      withBusy(rec.id + ':role', async () => {
        const res = await account.adminSetRole(rec.email, next);
        if (!res.ok) { role = prev; sync(); toast(tt('admin.actionFailed')); return; }
        toast(tt('admin.roleChangedToast', { name: rec.nickname || rec.email, role: tt('admin.role' + (next === 'admin' ? 'Admin' : 'Member')) }));
      });
    }
    memberBtn.addEventListener('click', () => choose('member'));
    adminBtn.addEventListener('click', () => choose('admin'));
    return h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:10px' }, [
      h('span', { style: 'font-size:11.5px;color:var(--ink-muted);font-weight:600' }, tt('admin.roleLabel')),
      h('div', { class: 'season-toggle', style: 'width:150px' }, [memberBtn, adminBtn]),
    ]);
  }

  async function withBusy(id, fn) {
    if (busyIds.has(id)) return;
    busyIds.add(id);
    try { await fn(); } catch { toast(tt('admin.actionFailed')); }
    finally { busyIds.delete(id); }
  }

  function render(docs) {
    const pending = [];
    const approved = [];
    const banned = [];
    const rejected = [];
    docs.forEach(d => {
      const data = d.data();
      if (!data) return;
      const rec = { id: d.id, ...data };
      if (rec.status === 'pending') pending.push(rec);
      else if (rec.status === 'approved') approved.push(rec);
      else if (rec.status === 'banned') banned.push(rec);
      else if (rec.status === 'rejected') rejected.push(rec);
    });
    pending.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    approved.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
    banned.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
    rejected.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));

    pendingSection.innerHTML = '';
    pendingSection.appendChild(sectionHead(tt('admin.pendingHeading'), { count: pending.length }));
    if (!pending.length) {
      pendingSection.appendChild(emptyState(tt('admin.noPending')));
    } else {
      pending.forEach(rec => {
        const picker = roleToggle();
        const approveBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => withBusy(rec.id, async () => {
          await db.doc('requests/' + rec.id).update({ status: 'approved', role: picker.get() });
          toast(tt('admin.approvedToast', { name: rec.nickname || rec.email }));
        }) }, tt('admin.approveCta'));
        const rejectBtn = h('button', { class: 'btn btn-ghost btn-sm', style: 'color:var(--critical)', onclick: () => withBusy(rec.id, async () => {
          await db.doc('requests/' + rec.id).update({ status: 'rejected' });
          toast(tt('admin.rejectedToast', { name: rec.nickname || rec.email }));
        }) }, tt('admin.rejectCta'));
        pendingSection.appendChild(personRow(rec, [approveBtn, rejectBtn], picker.el));
      });
    }

    approvedSection.innerHTML = '';
    approvedSection.appendChild(sectionHead(tt('admin.approvedHeading'), { count: approved.length }));
    if (!approved.length) {
      approvedSection.appendChild(emptyState(tt('admin.noApproved')));
    } else {
      approved.forEach(rec => {
        const isSelf = !!me && rec.email === me.email;
        const banBtn = h('button', {
          class: 'btn btn-ghost btn-sm', style: 'color:var(--critical)', disabled: isSelf ? 'true' : null,
          onclick: () => { if (!isSelf) confirmBan(rec); },
        }, tt('admin.banCta'));
        const deleteBtn = h('button', {
          class: 'btn btn-ghost btn-sm', style: 'color:var(--critical)', disabled: isSelf ? 'true' : null,
          onclick: () => { if (!isSelf) confirmDelete(rec); },
        }, tt('admin.deleteCta'));
        approvedSection.appendChild(personRow(rec, [banBtn, deleteBtn], roleChangeControl(rec)));
      });
    }

    bannedSection.innerHTML = '';
    if (banned.length) {
      bannedSection.appendChild(sectionHead(tt('admin.bannedHeading'), { count: banned.length }));
      banned.forEach(rec => {
        const unbanBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => withBusy(rec.id, async () => {
          await db.doc('requests/' + rec.id).update({ status: 'approved' });
          toast(tt('admin.unbannedToast', { name: rec.nickname || rec.email }));
        }) }, tt('admin.unbanCta'));
        const deleteBtn = h('button', {
          class: 'btn btn-ghost btn-sm', style: 'color:var(--critical)',
          onclick: () => confirmDelete(rec),
        }, tt('admin.deleteCta'));
        bannedSection.appendChild(personRow(rec, [unbanBtn, deleteBtn]));
      });
    }

    rejectedSection.innerHTML = '';
    if (rejected.length) {
      rejectedSection.appendChild(sectionHead(tt('admin.rejectedHeading'), { count: rejected.length }));
      rejected.forEach(rec => {
        const approveBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => withBusy(rec.id, async () => {
          await db.doc('requests/' + rec.id).update({ status: 'approved' });
          toast(tt('admin.approvedToast', { name: rec.nickname || rec.email }));
        }) }, tt('admin.approveCta'));
        rejectedSection.appendChild(personRow(rec, [approveBtn]));
      });
    }
  }

  function confirmDelete(rec) {
    const name = rec.nickname || rec.email;
    const body = h('div', {}, [
      h('p', { style: 'font-size:13.5px;color:var(--ink-secondary)' }, tt('admin.deleteConfirmBody', { name })),
    ]);
    const modalHandle = openModal({
      title: tt('admin.deleteConfirmTitle'),
      body,
      footer: h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => modalHandle.close() }, tt('common.cancel')),
        h('button', { class: 'btn btn-sm', style: 'background:var(--critical);border-color:var(--critical);color:#fff', onclick: () => withBusy(rec.id, async () => {
          await db.doc('requests/' + rec.id).delete();
          toast(tt('admin.deletedToast', { name }));
          modalHandle.close();
        }) }, tt('admin.deleteCta')),
      ]),
    });
  }

  function confirmBan(rec) {
    const name = rec.nickname || rec.email;
    const body = h('div', {}, [
      h('p', { style: 'font-size:13.5px;color:var(--ink-secondary)' }, tt('admin.banConfirmBody', { name })),
    ]);
    const modalHandle = openModal({
      title: tt('admin.banConfirmTitle'),
      body,
      footer: h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => modalHandle.close() }, tt('common.cancel')),
        h('button', { class: 'btn btn-sm', style: 'background:var(--critical);border-color:var(--critical);color:#fff', onclick: () => withBusy(rec.id, async () => {
          await db.doc('requests/' + rec.id).update({ status: 'banned' });
          toast(tt('admin.bannedToast', { name }));
          modalHandle.close();
        }) }, tt('admin.banCta')),
      ]),
    });
  }

  // ---- Password reset requests -------------------------------------------
  // The super admin never sets a password here — "Approve" just opens the
  // door for the user to set their OWN new password (see
  // account.adminApprovePasswordReset); "Dismiss" declines without doing
  // that, e.g. if the request looks bogus.
  function resetRow(rec) {
    const isApproved = rec.status === 'approved';
    const approveBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => withBusy('reset:' + rec.email, async () => {
      const res = await account.adminApprovePasswordReset(rec.email);
      if (!res.ok) { toast(tt('admin.actionFailed')); return; }
      toast(tt('admin.resetApprovedToast', { email: rec.email }));
    }) }, tt('admin.resetApproveCta'));
    const dismissBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => withBusy('reset:' + rec.email, async () => {
      const res = await account.adminDismissPasswordReset(rec.email);
      if (!res.ok) { toast(tt('admin.actionFailed')); return; }
    }) }, tt('admin.resetDismissCta'));
    return h('div', { class: 'card', style: 'display:flex;align-items:center;gap:12px;margin-bottom:8px' }, [
      avatarInitial(rec.email, 36),
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { style: 'font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, rec.email), // reset requests only carry email, no avatarColor to look up here
        isApproved
          ? h('div', { style: 'font-size:11.5px;color:var(--positive,var(--ink-secondary));margin-top:2px;font-weight:600' }, tt('admin.resetWaitingForUser'))
          : (rec.requestedAt ? h('div', { style: 'font-size:11px;color:var(--ink-muted);margin-top:2px' }, tt('admin.requestedOn', { date: fmtWhen(rec.requestedAt) })) : null),
      ]),
      h('div', { style: 'display:flex;gap:6px;flex-shrink:0' }, isApproved ? [dismissBtn] : [approveBtn, dismissBtn]),
    ]);
  }

  db.collection('password_resets').onSnapshot((snap) => {
    resetSection.innerHTML = '';
    const resets = snap.docs.map(d => d.data()).filter(Boolean).sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    if (!resets.length) return; // stays fully hidden when there's nothing to do
    resetSection.appendChild(sectionHead(tt('admin.resetRequestsHeading'), { count: resets.length }));
    resets.forEach(rec => resetSection.appendChild(resetRow(rec)));
  }, () => { /* best-effort — the rest of the panel still works */ });

  db.collection('requests').onSnapshot((snap) => {
    render(snap.docs);
  }, () => {
    toast(tt('admin.actionFailed'));
  });
}
