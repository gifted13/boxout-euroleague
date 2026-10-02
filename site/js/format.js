// ============================================================================
// Formatting helpers + the Stat Explanation registry (the ⓘ tooltip system).
// Every stat shown anywhere in the app should have an entry here so a plain-
// language explanation + formula is always one hover away.
//
// STAT_META entries carry both an English and a Greek label/description
// (label/label_el, desc/desc_el) so the whole registry works for both UI
// languages from one source of truth. statLabel()/statDesc()/fmtDate() read
// the current language straight from state.js — no lang param needed at
// call sites.
// ============================================================================

import { state } from './state.js';

const DATE_LOCALE = { en: 'en-GB', el: 'el-GR' };

export function fmtNum(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return Number(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return Math.round(Number(x)).toLocaleString('en-US');
}

export function fmtPct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return (Number(x) * 100).toFixed(digits) + '%';
}

export function fmtSigned(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const v = Number(x);
  const s = v > 0 ? '+' : '';
  return s + v.toFixed(digits);
}

export function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString(DATE_LOCALE[state.lang] || 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateShort(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString(DATE_LOCALE[state.lang] || 'en-GB', { day: '2-digit', month: 'short' });
}

// Date + time (viewer's own local timezone, via Date's default behavior) —
// used where a timestamp needs to read down to the minute, e.g. the admin
// panel's "last seen" column, not just the day.
export function fmtDateTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString(DATE_LOCALE[state.lang] || 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ----------------------------------------------------------------------------
// Game kickoff times — always shown in Athens time, regardless of viewer or
// which team the game involves.
//
// schedule.json's `startime` field ("20:45") is Central European Time
// (Paris/Berlin/Madrid/Rome's own clock: CET in winter, CEST in summer) for
// EVERY game, not the home team's own local time — despite what an earlier
// pass at this concluded from a single calendar-PDF example. Re-verified
// 2025-09-22 by cross-checking all 20 games of the 2026-27 season's first
// two rounds (every home-team timezone: Athens, Istanbul, Belgrade, Madrid,
// Paris, Rome, Berlin, Vilnius, Tel Aviv, Dubai) one by one against the
// live kickoff time on euroleaguebasketball.net — every single game matched
// "startime read as Europe/Paris time, then converted to Athens", and nothing
// matched "startime read as the home team's own local time". Athens is
// always exactly 1 hour ahead of Central Europe (both regions apply EU-wide
// DST on the same date), so this conversion never has a seasonal edge case —
// it's a fixed +1h, just derived through a real IANA zone instead of bare
// arithmetic so any future DST-rule change is inherited for free.
// ----------------------------------------------------------------------------
const SOURCE_TZ = 'Europe/Paris'; // schedule.json's startime field's own zone
const ATHENS_TZ = 'Europe/Athens';

// Converts a wall-clock time (year/month/day/hour/minute, as read on a
// clock in `timeZone`) into the real UTC instant it represents — the
// standard Intl-only trick: format a naive "as if UTC" guess back out in
// `timeZone`, measure how far that drifted, and correct by the difference.
// DST-safe because the offset is looked up for this specific date, not
// assumed fixed.
function zonedWallTimeToUtc(y, mo, d, h, mi, timeZone) {
  const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guessUtcMs)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asIfLocalMs = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guessUtcMs - (asIfLocalMs - guessUtcMs));
}

// The real UTC instant a schedule row's kickoff represents (needs .date
// "Sep 30, 2025", .startime "20:45") — null if anything about the row can't
// be parsed. Shared by gameTimeAthens() below and by the chronological sort
// in schedule.js/my-team.js, so "order by kickoff" and "display kickoff in
// Athens time" can never disagree with each other.
export function gameStartMs(game) {
  const raw = game && game.startime;
  if (!raw || !game.date) return null;
  const d = new Date(game.date);
  const [hh, mm] = String(raw).split(':').map(Number);
  if (Number.isNaN(d.getTime()) || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  try {
    return zonedWallTimeToUtc(d.getFullYear(), d.getMonth() + 1, d.getDate(), hh, mm, SOURCE_TZ).getTime();
  } catch { return null; }
}

// Takes a schedule row and returns that kickoff re-expressed as an 'HH:MM'
// string in Athens time. Falls back to the raw startime unchanged if
// gameStartMs() couldn't parse it — never worse than what the tile showed
// before this existed.
export function gameTimeAthens(game) {
  const raw = (game && game.startime) || '—';
  const ms = gameStartMs(game);
  if (ms === null) return raw;
  return new Date(ms).toLocaleTimeString('en-GB', { timeZone: ATHENS_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

const ROMAN_OR_SUFFIX = new Set(['II', 'III', 'IV', 'V', 'JR', 'SR']);
export function titleCase(name) {
  // "MALEDON, THEO" -> "Theo Maledon"; keeps suffixes like III/JR upper-case.
  if (!name) return '';
  const capWord = w => ROMAN_OR_SUFFIX.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const cap = s => s.toLowerCase().split(/(\s|-)/).map(part => /\s|-/.test(part) ? part : capWord(part)).join('');
  const parts = name.split(',').map(s => s.trim());
  if (parts.length === 2) return `${cap(parts[1])} ${cap(parts[0])}`;
  return cap(name);
}

export function initials(name) {
  const t = titleCase(name);
  return t.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Deterministic accent color for an avatar/team chip from a string, and
// also the fixed palette members choose from on their Profile page (see
// js/views/profile.js) — same eight theme-aware tokens either way, so a
// hand-picked avatar color always looks native, in light or dark mode.
export const AVATAR_HUES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];
export function hashColor(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

// ----------------------------------------------------------------------------
// Stat metadata registry
// key -> { label, short, fmt, higherIsBetter, group, desc, formula }
// fmt: 'num1' | 'num2' | 'int' | 'pct1' | 'signed1'
// ----------------------------------------------------------------------------
export const STAT_META = {
  PTS: { label: 'Points', label_el: 'Πόντοι', short: 'PTS', fmt: 'num1', hib: true, group: 'scoring', desc: 'Average points scored per game.', desc_el: 'Μέσος όρος πόντων ανά αγώνα.' },
  MIN: { label: 'Minutes', label_el: 'Λεπτά', short: 'MIN', fmt: 'num1', hib: true, group: 'usage', desc: 'Average minutes played per game.', desc_el: 'Μέσος όρος λεπτών συμμετοχής ανά αγώνα.' },
  GP: { label: 'Games Played', label_el: 'Αγώνες', short: 'GP', fmt: 'int', hib: true, group: 'usage', desc: 'Games appeared in with recorded minutes.', desc_el: 'Αγώνες συμμετοχής με καταγεγραμμένα λεπτά.' },
  GS: { label: 'Games Started', label_el: 'Αγώνες ως Βασικός', short: 'GS', fmt: 'int', hib: true, group: 'usage', desc: 'Games started in the lineup.', desc_el: 'Αγώνες που ξεκίνησε στην αρχική πεντάδα.' },
  TRB: { label: 'Rebounds', label_el: 'Ριμπάουντ', short: 'REB', fmt: 'num1', hib: true, group: 'rebounding', desc: 'Average total rebounds (offensive + defensive) per game.', desc_el: 'Μέσος όρος συνολικών ριμπάουντ (επιθετικά + αμυντικά) ανά αγώνα.' },
  ORB: { label: 'Off. Rebounds', label_el: 'Επιθ. Ριμπάουντ', short: 'OREB', fmt: 'num1', hib: true, group: 'rebounding', desc: 'Average offensive rebounds per game — missed shots recovered by the shooting team.', desc_el: 'Μέσος όρος επιθετικών ριμπάουντ ανά αγώνα — χαμένα σουτ που ανακτά η ομάδα που σουτάρει.' },
  DRB: { label: 'Def. Rebounds', label_el: 'Αμυντ. Ριμπάουντ', short: 'DREB', fmt: 'num1', hib: true, group: 'rebounding', desc: 'Average defensive rebounds per game.', desc_el: 'Μέσος όρος αμυντικών ριμπάουντ ανά αγώνα.' },
  AST: { label: 'Assists', label_el: 'Ασίστ', short: 'AST', fmt: 'num1', hib: true, group: 'playmaking', desc: 'Average passes leading directly to a made basket, per game.', desc_el: 'Μέσος όρος πασών που οδηγούν άμεσα σε εύστοχο καλάθι, ανά αγώνα.' },
  STL: { label: 'Steals', label_el: 'Κλεψίματα', short: 'STL', fmt: 'num1', hib: true, group: 'defense', desc: 'Average balls taken from the opponent per game.', desc_el: 'Μέσος όρος μπαλών που κλέβονται από τον αντίπαλο, ανά αγώνα.' },
  BLK: { label: 'Blocks', label_el: 'Κοψίματα', short: 'BLK', fmt: 'num1', hib: true, group: 'defense', desc: 'Average opponent shots blocked per game.', desc_el: 'Μέσος όρος αντίπαλων σουτ που κόβονται, ανά αγώνα.' },
  BLKA: { label: 'Blocks Against', label_el: 'Κοψίματα Εναντίον', short: 'BLK AG', fmt: 'num1', hib: false, group: 'defense', desc: 'Average own shots blocked by an opponent, per game.', desc_el: 'Μέσος όρος ιδίων σουτ που κόβονται από αντίπαλο, ανά αγώνα.' },
  TOV: { label: 'Turnovers', label_el: 'Λάθη', short: 'TOV', fmt: 'num1', hib: false, group: 'ballhandling', desc: 'Average turnovers per game — possessions lost without a shot attempt reaching its value.', desc_el: 'Μέσος όρος λαθών ανά αγώνα — κατοχές που χάνονται χωρίς να ολοκληρωθεί σουτ.' },
  PF: { label: 'Fouls Committed', label_el: 'Προσωπικά Φάουλ', short: 'PF', fmt: 'num1', hib: false, group: 'discipline', desc: 'Average personal fouls committed per game.', desc_el: 'Μέσος όρος προσωπικών φάουλ ανά αγώνα.' },
  PFR: { label: 'Fouls Drawn', label_el: 'Φάουλ που Κέρδισε', short: 'PF DRAWN', fmt: 'num1', hib: true, group: 'discipline', desc: 'Average fouls drawn from opponents per game.', desc_el: 'Μέσος όρος φάουλ που κερδίζονται από αντιπάλους, ανά αγώνα.' },
  VAL: { label: 'Valuation (PIR)', label_el: 'Αξιολόγηση (PIR)', short: 'VAL', fmt: 'num1', hib: true, group: 'overall', desc: 'EuroLeague’s official efficiency index: (points + rebounds + assists + steals + blocks + fouls drawn) minus (missed shots + turnovers + fouls committed + shots rejected). A single-number stand-in for overall game impact.', desc_el: 'Ο επίσημος δείκτης απόδοσης της EuroLeague: (πόντοι + ριμπάουντ + ασίστ + κλεψίματα + κοψίματα + φάουλ που κερδήθηκαν) μείον (χαμένα σουτ + λάθη + φάουλ που έγιναν + σουτ που κόπηκαν). Ένας ενιαίος δείκτης συνολικής συμβολής στο παιχνίδι.' },
  PM: { label: 'Plus / Minus', label_el: 'Πλην / Συν', short: '+/-', fmt: 'signed1', hib: true, group: 'overall', desc: 'Average team point differential while this player is on the court.', desc_el: 'Μέση διαφορά πόντων της ομάδας όσο ο παίκτης είναι στο παρκέ.' },
  FG2_PCT: { label: '2PT Field Goal %', label_el: 'Δίποντα %', short: '2P%', fmt: 'pct1', hib: true, group: 'shooting', desc: 'Two-point shots made divided by two-point shots attempted.', desc_el: 'Εύστοχα δίποντα προς επιχειρηθέντα δίποντα.' },
  FG3_PCT: { label: '3PT Field Goal %', label_el: 'Τρίποντα %', short: '3P%', fmt: 'pct1', hib: true, group: 'shooting', desc: 'Three-point shots made divided by three-point shots attempted.', desc_el: 'Εύστοχα τρίποντα προς επιχειρηθέντα τρίποντα.' },
  FT_PCT: { label: 'Free Throw %', label_el: 'Βολές %', short: 'FT%', fmt: 'pct1', hib: true, group: 'shooting', desc: 'Free throws made divided by free throws attempted.', desc_el: 'Εύστοχες βολές προς επιχειρηθείσες βολές.' },
  FG_PCT: { label: 'Field Goal %', label_el: 'Σουτ %', short: 'FG%', fmt: 'pct1', hib: true, group: 'shooting', desc: 'All made shots (2PT + 3PT) divided by all shots attempted.', desc_el: 'Όλα τα εύστοχα σουτ (δίποντα + τρίποντα) προς όλα τα επιχειρηθέντα σουτ.' },
  TS_PCT: {
    label: 'True Shooting %', label_el: 'Πραγματικό Σουτ %', short: 'TS%', fmt: 'pct1', hib: true, group: 'shooting',
    desc: 'Scoring efficiency that folds free throws and the extra value of three-pointers into one shooting percentage, so a player who scores efficiently from the line or beyond the arc isn’t penalized the way raw FG% penalizes them.',
    desc_el: 'Δείκτης σκοραριστικής αποδοτικότητας που συνυπολογίζει τις βολές και την επιπλέον αξία των τριπόντων σε ένα ενιαίο ποσοστό, ώστε ένας παίκτης που σκοράρει αποδοτικά από τη γραμμή ή πίσω από το τόξο να μην αδικείται όπως στο απλό FG%.',
    formula: 'TS% = PTS / (2 × (FGA + 0.44 × FTA))',
  },
  EFG_PCT: {
    label: 'Effective FG %', label_el: 'Αποδοτικό FG %', short: 'eFG%', fmt: 'pct1', hib: true, group: 'shooting',
    desc: 'Field-goal percentage adjusted to give three-pointers their extra 50% value, so 2PT and 3PT shooting can be compared on one scale.',
    desc_el: 'Ποσοστό σουτ προσαρμοσμένο ώστε τα τρίποντα να έχουν την επιπλέον αξία του 50%, επιτρέποντας τη σύγκριση δίποντων και τρίποντων σε ενιαία κλίμακα.',
    formula: 'eFG% = (FGM2 + 1.5 × FGM3) / FGA',
  },
  PTS_PER36: { label: 'Points per 36', label_el: 'Πόντοι ανά 36\'', short: 'PTS/36', fmt: 'num1', hib: true, group: 'per36', desc: 'Points scored, scaled to a 36-minute pace — lets bench and starter workloads be compared on the same footing.', desc_el: 'Πόντοι κλιμακωμένοι σε ρυθμό 36 λεπτών — επιτρέπει τη σύγκριση φόρτου παικτών πάγκου και βασικής πεντάδας στην ίδια βάση.' },
  TRB_PER36: { label: 'Rebounds per 36', label_el: 'Ριμπάουντ ανά 36\'', short: 'REB/36', fmt: 'num1', hib: true, group: 'per36', desc: 'Rebounds, scaled to a 36-minute pace.', desc_el: 'Ριμπάουντ κλιμακωμένα σε ρυθμό 36 λεπτών.' },
  AST_PER36: { label: 'Assists per 36', label_el: 'Ασίστ ανά 36\'', short: 'AST/36', fmt: 'num1', hib: true, group: 'per36', desc: 'Assists, scaled to a 36-minute pace.', desc_el: 'Ασίστ κλιμακωμένα σε ρυθμό 36 λεπτών.' },
  STL_PER36: { label: 'Steals per 36', label_el: 'Κλεψίματα ανά 36\'', short: 'STL/36', fmt: 'num1', hib: true, group: 'per36', desc: 'Steals, scaled to a 36-minute pace.', desc_el: 'Κλεψίματα κλιμακωμένα σε ρυθμό 36 λεπτών.' },
  BLK_PER36: { label: 'Blocks per 36', label_el: 'Κοψίματα ανά 36\'', short: 'BLK/36', fmt: 'num1', hib: true, group: 'per36', desc: 'Blocks, scaled to a 36-minute pace.', desc_el: 'Κοψίματα κλιμακωμένα σε ρυθμό 36 λεπτών.' },
  TOV_PER36: { label: 'Turnovers per 36', label_el: 'Λάθη ανά 36\'', short: 'TOV/36', fmt: 'num1', hib: false, group: 'per36', desc: 'Turnovers, scaled to a 36-minute pace.', desc_el: 'Λάθη κλιμακωμένα σε ρυθμό 36 λεπτών.' },

  // Team-level advanced
  PPG: { label: 'Points per Game', label_el: 'Πόντοι ανά Αγώνα', short: 'PPG', fmt: 'num1', hib: true, group: 'scoring', desc: 'Team average points scored per game.', desc_el: 'Μέσος όρος πόντων ομάδας ανά αγώνα.' },
  PACE: { label: 'Pace', label_el: 'Ρυθμός', short: 'PACE', fmt: 'num1', hib: null, group: 'advanced', desc: 'Estimated possessions per 40 minutes. Higher pace means more possessions for both teams — neither inherently good nor bad.', desc_el: 'Εκτιμώμενες κατοχές ανά 40 λεπτά. Υψηλότερος ρυθμός σημαίνει περισσότερες κατοχές και για τις δύο ομάδες — δεν είναι από μόνο του καλό ή κακό.' },
  ORtg: { label: 'Offensive Rating', label_el: 'Επιθετικός Δείκτης', short: 'ORTG', fmt: 'num1', hib: true, group: 'advanced', desc: 'Points scored per 100 possessions — efficiency of the offense independent of pace.', desc_el: 'Πόντοι ανά 100 κατοχές — αποδοτικότητα επίθεσης ανεξάρτητη από τον ρυθμό.' },
  DRtg: { label: 'Defensive Rating', label_el: 'Αμυντικός Δείκτης', short: 'DRTG', fmt: 'num1', hib: false, group: 'advanced', desc: 'Points allowed per 100 possessions — efficiency of the defense independent of pace. Lower is better.', desc_el: 'Πόντοι που δέχεται ανά 100 κατοχές — αποδοτικότητα άμυνας ανεξάρτητη από τον ρυθμό. Μικρότερο είναι καλύτερο.' },
  NET_RTG: { label: 'Net Rating', label_el: 'Καθαρός Δείκτης', short: 'NET', fmt: 'signed1', hib: true, group: 'advanced', desc: 'Offensive Rating minus Defensive Rating — the point margin per 100 possessions.', desc_el: 'Επιθετικός Δείκτης μείον Αμυντικός Δείκτης — η διαφορά πόντων ανά 100 κατοχές.', formula: 'NET_RTG = ORtg − DRtg' },
  eFG: { label: 'Effective FG %', label_el: 'Αποδοτικό FG %', short: 'eFG%', fmt: 'pct1', hib: true, group: 'advanced', desc: 'Team effective field goal percentage (3PT weighted at 1.5×).', desc_el: 'Αποδοτικό ποσοστό σουτ ομάδας (τα τρίποντα μετρούν ×1,5).' },
  TOV_PCT: { label: 'Turnover %', label_el: 'Λάθη %', short: 'TOV%', fmt: 'pct1', hib: false, group: 'advanced', desc: 'Estimated share of possessions ending in a turnover.', desc_el: 'Εκτιμώμενο ποσοστό κατοχών που καταλήγουν σε λάθος.' },
  FT_per_FGA: { label: 'Free Throw Rate', label_el: 'Δείκτης Βολών', short: 'FTR', fmt: 'pct1', hib: true, group: 'advanced', desc: 'Free throws attempted per field goal attempted — a proxy for how often a team gets to the line.', desc_el: 'Επιχειρηθείσες βολές ανά επιχειρηθέν σουτ — δείχνει πόσο συχνά μια ομάδα φτάνει στη γραμμή βολών.' },
  ORB_PCT: { label: 'Off. Rebound %', label_el: 'Επιθ. Ριμπάουντ %', short: 'OREB%', fmt: 'pct1', hib: true, group: 'advanced', desc: 'Share of available offensive rebounds a team collects.', desc_el: 'Ποσοστό διαθέσιμων επιθετικών ριμπάουντ που μαζεύει μια ομάδα.' },
  AST_PCT: { label: 'Assist %', label_el: 'Ασίστ %', short: 'AST%', fmt: 'pct1', hib: true, group: 'advanced', desc: 'Share of made field goals that were assisted.', desc_el: 'Ποσοστό εύστοχων σουτ που προήλθαν από ασίστ.' },
  OPP_TOV_PCT: { label: 'Opp. Turnover %', label_el: 'Λάθη Αντιπάλου %', short: 'OPP TOV%', fmt: 'pct1', hib: true, group: 'advanced', desc: 'Share of opponent possessions forced into a turnover.', desc_el: 'Ποσοστό κατοχών του αντιπάλου που καταλήγουν σε λάθος.' },
  OPP_ORB_PCT: { label: 'Opp. Off. Reb %', label_el: 'Επιθ. Ριμπάουντ Αντιπάλου %', short: 'OPP OREB%', fmt: 'pct1', hib: false, group: 'advanced', desc: 'Share of available offensive rebounds the opponent collects against this team.', desc_el: 'Ποσοστό διαθέσιμων επιθετικών ριμπάουντ που μαζεύει ο αντίπαλος.' },
  OPP_EFG: { label: 'Opp. Effective FG %', label_el: 'Αποδοτικό FG % Αντιπάλου', short: 'OPP eFG%', fmt: 'pct1', hib: false, group: 'advanced', desc: 'Effective field goal percentage allowed to opponents.', desc_el: 'Αποδοτικό ποσοστό σουτ που επιτρέπεται στους αντιπάλους.' },
  win_pct: { label: 'Win %', label_el: 'Νίκες %', short: 'WIN%', fmt: 'pct1', hib: true, group: 'record', desc: 'Regular season wins divided by games played.', desc_el: 'Νίκες κανονικής περιόδου προς αγώνες που έχουν παιχτεί.' },
  point_diff: { label: 'Point Differential', label_el: 'Διαφορά Πόντων', short: 'DIFF', fmt: 'signed1', hib: true, group: 'record', desc: 'Total points scored minus total points allowed, season to date.', desc_el: 'Σύνολο πόντων υπέρ μείον σύνολο πόντων κατά, έως τώρα στη σεζόν.' },
};

export function fmtStat(key, val) {
  const meta = STAT_META[key];
  const fmt = meta ? meta.fmt : 'num1';
  switch (fmt) {
    case 'int': return fmtInt(val);
    case 'pct1': return fmtPct(val, 1);
    case 'signed1': return fmtSigned(val, 1);
    case 'num2': return fmtNum(val, 2);
    default: return fmtNum(val, 1);
  }
}

export function statLabel(key) {
  const meta = STAT_META[key];
  if (!meta) return key;
  return (state.lang === 'el' && meta.label_el) || meta.label;
}
export function statShort(key) { return (STAT_META[key] && STAT_META[key].short) || key; }
export function statDesc(key) {
  const meta = STAT_META[key];
  if (!meta) return '';
  return (state.lang === 'el' && meta.desc_el) || meta.desc || '';
}
export function statFormula(key) { return (STAT_META[key] && STAT_META[key].formula) || null; }
