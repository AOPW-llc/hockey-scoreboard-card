/**
 * Hockey Scoreboard Card — live NHL scores, stats, scoring summaries and division standings
 * https://github.com/AOPW-llc/hockey-scoreboard-card
 *
 * Data: ESPN's public scoreboard, game summary and standings feeds (CORS-open,
 * no key). Times are shown in the browser's time zone; a "day" is the local
 * calendar day, so a late game belongs to the evening it starts.
 */

const VERSION = '1.0.0';
const CARD_TAG = 'hockey-scoreboard-card';

const API = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const STANDINGS_API = 'https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings?level=3';
const IDLE_REFRESH_S = 300;        // no live games in the days on screen
const STANDINGS_REFRESH_S = 1800;
const FETCH_TIMEOUT_MS = 10000;

const TEAMS = [
  ['ANA', 'Anaheim Ducks'], ['BOS', 'Boston Bruins'], ['BUF', 'Buffalo Sabres'], ['CGY', 'Calgary Flames'],
  ['CAR', 'Carolina Hurricanes'], ['CHI', 'Chicago Blackhawks'], ['COL', 'Colorado Avalanche'], ['CBJ', 'Columbus Blue Jackets'],
  ['DAL', 'Dallas Stars'], ['DET', 'Detroit Red Wings'], ['EDM', 'Edmonton Oilers'], ['FLA', 'Florida Panthers'],
  ['LA', 'Los Angeles Kings'], ['MIN', 'Minnesota Wild'], ['MTL', 'Montreal Canadiens'], ['NSH', 'Nashville Predators'],
  ['NJ', 'New Jersey Devils'], ['NYI', 'New York Islanders'], ['NYR', 'New York Rangers'], ['OTT', 'Ottawa Senators'],
  ['PHI', 'Philadelphia Flyers'], ['PIT', 'Pittsburgh Penguins'], ['SJ', 'San Jose Sharks'], ['SEA', 'Seattle Kraken'],
  ['STL', 'St. Louis Blues'], ['TB', 'Tampa Bay Lightning'], ['TOR', 'Toronto Maple Leafs'], ['UTAH', 'Utah Mammoth'],
  ['VAN', 'Vancouver Canucks'], ['VGK', 'Vegas Golden Knights'], ['WSH', 'Washington Capitals'], ['WPG', 'Winnipeg Jets'],
];

// Box score rows: [ESPN stat name, label, better: 1 = higher, -1 = lower, 0 = neither]
// "powerPlay" is built from the goals and opportunities stats.
const STAT_ROWS = [
  ['shotsTotal', 'Shots', 1],
  ['powerPlay', 'Power Play', 0],
  ['faceoffPercent', 'Faceoff %', 1],
  ['hits', 'Hits', 0],
  ['blockedShots', 'Blocked Shots', 0],
  ['takeaways', 'Takeaways', 1],
  ['giveaways', 'Giveaways', -1],
  ['penaltyMinutes', 'Penalty Minutes', -1],
];
const TEAM_STATS_API = 'https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/statistics/byteam?region=us&lang=en&contentorigin=espn&limit=40';
const TEAM_STATS_REFRESH_S = 1800;

// Season stats in the team view: [label, key, better: 1 = higher / -1 = lower, decimals, format]
// Keys are side.category.stat; "calc" keys are per-game rates worked out in parseTeamStats.
const SEASON_ROWS = [
  ['Goals / game', 'own.offensive.avgGoals', 1, 2],
  ['Goals against / game', 'own.defensive.avgGoalsAgainst', -1, 2],
  ['Shots / game', 'calc.shotsPerGame', 1, 1],
  ['Shots against / game', 'calc.shotsAgainstPerGame', -1, 1],
  ['Power play %', 'own.offensive.powerPlayPct', 1, 1, 'pct'],
  ['Penalty kill %', 'own.defensive.penaltyKillPct', 1, 1, 'pct'],
  ['Shooting %', 'own.offensive.shootingPct', 1, 1, 'pct'],
  ['Save %', 'own.defensive.savePct', 1, 3, 'svpct'],
  ['Shutouts', 'own.defensive.shutouts', 1, 0],
  ['Penalty minutes / game', 'calc.pimPerGame', -1, 1],
];
const LEADER_ROWS = [['goals', 'Goals'], ['assists', 'Assists'], ['points', 'Points']];
const STARS = [['firstStar', '1st'], ['secondStar', '2nd'], ['thirdStar', '3rd']];
const STRENGTH = { 'power play': 'PP', 'short handed': 'SH', 'shorthanded': 'SH' };

/* ── helpers ── */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtDate = d => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
const fmtTime = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
const fmtShortDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
/** Period name: 1st–3rd, then OT; in the regular season the 5th is the shootout, in the playoffs it's 2OT and so on. */
const ordinal = (p, playoffs = false) => (p <= 3 ? ['1st', '2nd', '3rd'][p - 1]
  : p === 4 ? 'OT' : (!playoffs ? 'SO' : `${p - 3}OT`));
const firstNum = v => { const m = String(v ?? '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

/** Scoreboard events for each ESPN date (YYYYMMDD); the feed doesn't take date ranges. */
async function getEvents(days) {
  const all = await Promise.all(days.map(d => getJSON(`${API}/scoreboard?dates=${ymd(d)}`)));
  const seen = new Set();
  return all.flatMap(r => r.events ?? []).filter(e => !seen.has(e.id) && seen.add(e.id));
}

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ── game model ── */

/** Flatten an ESPN scoreboard event into what the card needs. */
function parseGame(ev) {
  const comp = ev.competitions?.[0] ?? {};
  const status = comp.status ?? ev.status ?? {};
  const type = status.type ?? {};
  const team = c => ({
    id: c.team?.id,
    abbr: c.team?.abbreviation ?? '',
    city: c.team?.location ?? '',
    name: c.team?.name ?? c.team?.shortDisplayName ?? '',
    full: c.team?.displayName ?? '',
    logo: c.team?.logo ?? '',
    color: c.team?.color ? `#${c.team.color}` : null,
    score: c.score ?? '',
    winner: c.winner === true,
    record: c.records?.find(r => r.type === 'total' || r.type === 'ytd')?.summary ?? '',
    homeAway: c.homeAway,
    split: c.records?.find(r => r.type === (c.homeAway === 'home' ? 'home' : 'road'))?.summary ?? '',
    linescores: (c.linescores ?? []).map(l => ({ period: l.period, value: l.displayValue ?? l.value })),
  });
  const comps = comp.competitors ?? [];
  const away = comps.find(c => c.homeAway === 'away') ?? comps[0];
  const home = comps.find(c => c.homeAway === 'home') ?? comps[1];
  const odds = comp.odds?.[0];
  return {
    id: ev.id,
    playoffs: ev.season?.type === 3,
    preseason: ev.season?.type === 1,
    date: new Date(comp.date ?? ev.date),
    timeValid: comp.timeValid !== false,
    state: type.state ?? 'pre',           // pre | in | post
    statusName: type.name ?? '',
    shortDetail: type.shortDetail ?? '',
    clock: status.displayClock ?? '',
    period: status.period ?? 0,
    away: team(away ?? {}),
    home: team(home ?? {}),
    venue: comp.venue?.fullName ?? '',
    venueCity: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(', '),
    tv: (comp.broadcasts ?? []).flatMap(b => b.names ?? []).join(', '),
    odds: odds ? { details: odds.details ?? '', overUnder: odds.overUnder ?? null } : null,
    neutral: comp.neutralSite === true,
    note: comp.notes?.[0]?.headline ?? '',  // playoff series, Winter Classic, …
    stars: STARS.map(([n, label]) => {
      const a = status.featuredAthletes?.find(f => f.name === n);
      return a ? { label, name: a.athlete?.shortName ?? '', team: a.team?.id ?? a.athlete?.team?.id } : null;
    }).filter(Boolean),
  };
}

/** Clock part of the dropdown label: "4:32/2nd", "Half", "End/1st", "Final", "Final/OT". */
function clockLabel(g) {
  if (g.state === 'post') return g.shortDetail || 'Final';
  if (g.statusName === 'STATUS_END_PERIOD') return `End/${ordinal(g.period, g.playoffs)}`;
  if (g.statusName !== 'STATUS_IN_PROGRESS' && g.shortDetail && !/\d+:\d+/.test(g.shortDetail)) return g.shortDetail; // delayed etc.
  if (g.period === 5 && !g.playoffs) return 'Shootout';
  return `${g.clock}/${ordinal(g.period, g.playoffs)}`;
}

/** Status shown in the middle of the matchup. */
function statusLabel(g) {
  if (g.state === 'pre') {
    if (/postponed|canceled|cancelled|delayed/i.test(g.statusName)) return g.shortDetail;
    return g.timeValid ? fmtTime(g.date) : 'TBD';
  }
  if (g.state === 'post') return g.shortDetail || 'Final';
  if (g.statusName === 'STATUS_END_PERIOD') return g.period < 3 ? `${ordinal(g.period)} Intermission` : `End of ${ordinal(g.period, g.playoffs)}`;
  if (g.period === 5 && !g.playoffs) return 'Shootout';
  return `${g.clock} · ${ordinal(g.period, g.playoffs)}`;
}

/** City for the dropdown; the two New York teams go by nickname ("NY Rangers", "NY Islanders"). */
const city = t => (t.city === 'New York' ? `NY ${t.name}` : t.city);
const cities = g => [city(g.away), city(g.home)];

function gameLabel(g) {
  const [a, h] = cities(g);
  if (g.state === 'pre') {
    const when = /postponed|canceled|cancelled/i.test(g.statusName) ? g.shortDetail : (g.timeValid ? fmtTime(g.date) : 'TBD');
    return `${a} v. ${h}, ${when}`;
  }
  return `${a} (${g.away.score}) - ${h} (${g.home.score}) ${clockLabel(g)}`;
}

/* ── standings ── */

/** One standings entry: record as W-L-OT and points. */
function standingsTeam(e) {
  const stat = n => e.stats?.find(s => s.name === n);
  const w = stat('wins')?.displayValue, l = stat('losses')?.displayValue, ot = stat('otLosses')?.displayValue;
  return {
    id: e.team?.id,
    abbr: e.team?.abbreviation ?? '',
    city: e.team?.location ?? '',
    name: e.team?.name ?? '',
    logo: e.team?.logos?.[0]?.href ?? '',
    record: w != null ? `${w}-${l ?? 0}-${ot ?? 0}` : (stat('overall')?.displayValue ?? '').replace(/,.*$/, ''),
    points: stat('points')?.displayValue ?? '',
  };
}

/** teamId → { record, points, division: { name, teams } } */
function parseStandings(data) {
  const map = {};
  for (const conf of data?.children ?? []) {
    for (const div of conf.children ?? []) {
      const teams = (div.standings?.entries ?? []).map(standingsTeam);
      // "Atlantic Division" → "Atlantic"
      const division = { name: (div.name ?? div.abbreviation ?? '').replace(/\s+Division$/, ''), teams };
      teams.forEach(t => { map[t.id] = { record: t.record, points: t.points, division }; });
    }
  }
  return map;
}

/** [{ abbr, name, divisions: [{ name, teams }] }], divisions in ESPN's standings order. */
function parseConferences(data) {
  return (data?.children ?? []).map(conf => {
    const divisions = (conf.children ?? []).map(div => ({
      name: (div.name ?? '').replace(/\s+Division$/, ''),
      teams: (div.standings?.entries ?? []).map(standingsTeam),
    }));
    // "Eastern Conference" → "East"
    return { abbr: conf.abbreviation ?? conf.name ?? '', name: conf.name ?? '', divisions, teams: divisions.flatMap(d => d.teams) };
  });
}

/** teamId → { abbr, full, logo, v: { 'own.passing.totalPointsPerGame': 27, ... } } */
function parseTeamStats(data) {
  const names = {};
  for (const c of data?.categories ?? []) names[c.name] = c.names ?? [];
  const map = {};
  for (const t of data?.teams ?? []) {
    const v = {};
    for (const c of t.categories ?? []) {
      // Each category comes twice: the team's own numbers (splitId 0) and its opponents' (900)
      const side = String(c.splitId) === '900' || /^opponent/i.test(c.displayName ?? '') ? 'opp' : 'own';
      (names[c.name] ?? []).forEach((n, i) => { if (v[`${side}.${c.name}.${n}`] === undefined) v[`${side}.${c.name}.${n}`] = c.values?.[i]; });
    }
    const gp = Number(v['own.general.games']);
    if (gp > 0) {
      v['calc.shotsPerGame'] = v['own.offensive.shotsTotal'] / gp;
      v['calc.shotsAgainstPerGame'] = v['own.defensive.shotsAgainst'] / gp;
      v['calc.pimPerGame'] = v['own.penalties.penaltyMinutes'] / gp;
    }
    map[t.team?.id] = { abbr: t.team?.abbreviation ?? '', full: t.team?.displayName ?? '', logo: t.team?.logos?.[0]?.href ?? '', v };
  }
  return map;
}

const rankLabel = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function fmtStat(x, decimals, format) {
  if (x == null || isNaN(x)) return '–';
  const t = Number(x).toFixed(decimals);
  if (format === 'pct') return `${t}%`;
  if (format === 'svpct') return t.replace(/^0(?=\.)/, '');
  if (format === 'signed' && x > 0) return `+${t}`;
  return t;
}

/* ═════════════════════════════ Card ═════════════════════════════ */

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .muted { color: var(--secondary-text-color); }

  /* card header */
  .top { display: flex; align-items: center; gap: 8px; padding: 12px 16px 4px; }
  .range { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
  .clock { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nav { background: none; border: none; color: var(--secondary-text-color); cursor: pointer; padding: 2px 10px;
    font-size: 26px; line-height: 1; border-radius: 8px; font-family: inherit; }
  .nav:hover, .today:hover { background: var(--secondary-background-color); }
  .today { font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 14px; cursor: pointer;
    border: 1px solid var(--primary-color); background: none; color: var(--primary-color); }
  .refresh { background: none; border: none; color: var(--secondary-text-color); cursor: pointer; font-size: 17px; padding: 2px 6px; }

  /* week strip: seven day columns, as many on screen as fit (--vis), swipe or scroll through the rest */
  .wkt { display: flex; flex-direction: column; justify-content: center; min-width: 0; margin-left: 4px; line-height: 1.2; }
  .wkn { font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wk { font-size: 15px; font-weight: 600; color: var(--secondary-text-color); white-space: nowrap; }
  .wkn + .wk { font-size: 12px; font-weight: 500; }
  .chips { display: flex; justify-content: safe center; gap: 4px; padding: 2px 12px 0; overflow-x: auto; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { font: inherit; flex: none; display: flex; flex-direction: column; align-items: center; min-width: 36px; padding: 3px 4px;
    border-radius: 10px; border: 1px solid transparent; background: none; color: var(--primary-text-color); cursor: pointer; line-height: 1.15; }
  .chip .l { font-size: 11px; color: var(--secondary-text-color); }
  .chip .d { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .chip.none .d { color: var(--secondary-text-color); font-weight: 400; }
  .chip.on { background: var(--secondary-background-color); }
  .chip.today { border-color: var(--primary-color); }
  .chip.today .l { color: var(--primary-color); font-weight: 600; }
  .cols { --gap: 12px; display: grid; grid-auto-flow: column; gap: var(--gap);
    grid-auto-columns: calc((100% - (var(--vis, 3) - 1) * var(--gap)) / var(--vis, 3));
    padding: 8px 16px 16px; scroll-padding-inline: 16px; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; }
  .cols.single { --gap: 24px; padding: 8px 12px 12px; scroll-padding-inline: 12px; }
  .cols.single .col { border: none; box-shadow: none; padding: 4px 2px; scroll-snap-stop: always; }
  .cols.single .col.is-today .dow { color: var(--primary-color); }
  .single-top .nav { padding: 4px 14px; font-size: 30px; }
  .cols.sliding { scroll-snap-type: none; scrollbar-width: none; pointer-events: none; }
  .cols.sliding::-webkit-scrollbar { display: none; }
  .col { container-type: inline-size; scroll-snap-align: start; min-width: 0; display: flex; flex-direction: column; gap: 14px;
    padding: 12px; border-radius: 14px; border: 1px solid var(--divider-color); }
  .col.is-today { border-color: var(--primary-color); box-shadow: inset 0 3px 0 var(--primary-color); }
  .dhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .date { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .count { font-size: 14px; font-weight: 400; color: var(--secondary-text-color); margin-left: 6px; }
  .dow { font-size: 13px; color: var(--secondary-text-color); }
  .is-today .dow { color: var(--primary-color); font-weight: 600; }
  .picker { position: relative; }
  select { width: 100%; box-sizing: border-box; appearance: none; -webkit-appearance: none;
    font: inherit; font-size: 14px; padding: 9px 32px 9px 10px; border-radius: 10px;
    border: 1px solid var(--divider-color); background: var(--secondary-background-color);
    color: var(--primary-text-color); cursor: pointer; text-overflow: ellipsis; }
  .picker::after { content: ''; position: absolute; right: 12px; top: 50%; width: 7px; height: 7px; margin-top: -6px;
    border-right: 2px solid var(--secondary-text-color); border-bottom: 2px solid var(--secondary-text-color);
    transform: rotate(45deg); pointer-events: none; }
  .empty { text-align: center; padding: 18px 4px; }

  /* matchup */
  /* one grid for both teams: each row (logo, name, record, score) is shared, so a name that wraps on one side keeps the other side level */
  .matchup { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); column-gap: 6px; row-gap: 4px; align-items: start; justify-items: center; text-align: center; }
  .matchup > .away { grid-column: 1; }
  .matchup > .home { grid-column: 3; }
  .matchup > .mid { grid-column: 2; }
  .t-logo { align-self: stretch; justify-self: stretch; display: flex; justify-content: center;
    padding-top: 10px; border-top: 4px solid var(--tc, var(--divider-color)); border-radius: 2px; }
  .t-logo img { width: 52px; height: 52px; object-fit: contain; }
  .matchup .score { align-self: center; }
  .tname { font-size: 14px; font-weight: 600; line-height: 1.25; }
  .trec { font-size: 11px; color: var(--secondary-text-color); }
  .score { font-size: 38px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .lost.score, .lost.tname { opacity: .55; }
  .poss { font-size: 14px; }
  .mid { min-width: 52px; display: flex; flex-direction: column; align-items: center; gap: 6px; align-self: center; }
  .vs { font-size: 12px; color: var(--secondary-text-color); }
  .status { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .status.live { color: var(--error-color, #db4437); }
  .note { text-align: center; font-size: 12px; font-weight: 600; color: var(--secondary-text-color); margin-bottom: -6px; }
  .sit { text-align: center; font-size: 13px; padding: 7px 8px; border-radius: 10px; background: var(--secondary-background-color); }
  .sit.rz { box-shadow: inset 0 0 0 2px var(--error-color, #db4437); }
  .sit .tag { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: var(--error-color, #db4437); margin-left: 6px; }

  /* tables */
  h4 { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); }
  .fold { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; margin: 0 0 6px; cursor: pointer;
    font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--secondary-text-color); }
  .fold .hint { font-weight: 400; letter-spacing: 0; text-transform: none; opacity: .75; }
  .fold.closed { margin: 0; }
  .fold.closed::after { content: ''; flex: 1; border-top: 1px solid var(--divider-color); }
  .fold:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .lines th, .lines td { padding: 4px 3px; text-align: center; font-size: 13px; }
  .lines th { font-size: 11px; font-weight: 500; color: var(--secondary-text-color); }
  .lines td:first-child, .lines th:first-child { text-align: left; }
  .lines td:last-child { font-weight: 700; }
  .lines tr + tr td { border-top: 1px solid var(--divider-color); }
  .stats td { padding: 5px 3px; font-size: 13px; border-top: 1px solid var(--divider-color); }
  .stats td:first-child { text-align: left; width: 32%; }
  .stats td:last-child { text-align: right; width: 32%; }
  .stats td.lbl { text-align: center; color: var(--secondary-text-color); font-size: 12px; }
  .stats .best { font-weight: 700; }
  .stats tr.head td { border-top: none; font-weight: 600; font-size: 12px; }
  .leaders td { font-size: 12px; vertical-align: top; }
  .leaders .who { font-weight: 600; }
  .goals { width: 100%; border-collapse: collapse; font-size: 12px; }
  .goals td { padding: 4px 3px; border-top: 1px solid var(--divider-color); vertical-align: top; }
  .goals tr.per td { border-top: none; padding-top: 8px; font-size: 11px; font-weight: 600; color: var(--secondary-text-color); }
  .goals td.t { width: 40px; white-space: nowrap; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .goals td.tm { width: 34px; font-weight: 600; }
  .goals .who { font-weight: 600; }
  .goals .str { font-size: 10px; font-weight: 700; margin-left: 4px; color: var(--primary-color); }
  .goals .ast { display: block; color: var(--secondary-text-color); font-size: 11px; }
  .stars { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; }
  .stars .k { color: var(--secondary-text-color); margin-right: 4px; }
  .info { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 13px; }
  .info .k { color: var(--secondary-text-color); }

  /* divisions */
  .logo-btn { background: none; border: none; padding: 0; cursor: pointer; border-radius: 50%; line-height: 0; }
  .logo-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  /* team view */
  .back { font: inherit; font-size: 15px; background: none; border: none; color: var(--primary-color); cursor: pointer; padding: 6px 8px; border-radius: 8px; }
  .back:hover { background: var(--secondary-background-color); }
  .tv { container-type: inline-size; padding: 4px 16px 16px; display: flex; flex-direction: column; gap: 18px; }
  .tv-head { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 4px solid var(--tc, var(--divider-color)); }
  .tv-head img { width: 72px; height: 72px; object-fit: contain; flex: none; }
  .tv-name { font-size: 22px; font-weight: 700; line-height: 1.2; }
  .tv-sub { font-size: 14px; color: var(--secondary-text-color); margin-top: 2px; }
  .tv-body { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: start; }
  .season td { padding: 7px 4px; font-size: 14px; border-top: 1px solid var(--divider-color); vertical-align: middle; }
  .season th { padding: 0 4px 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--secondary-text-color); text-align: right; }
  .season th:first-child, .season td:first-child { text-align: left; }
  .season td.v, .season td.ld { text-align: right; white-space: nowrap; }
  .season td.v b { font-size: 15px; }
  .season .rk { display: block; font-size: 11px; color: var(--secondary-text-color); }
  .season tr.top .rk { color: var(--primary-color); font-weight: 700; }
  .season .ld img { width: 18px; height: 18px; vertical-align: -4px; margin-right: 4px; }
  .season .ld .who { color: var(--secondary-text-color); font-size: 12px; margin-right: 4px; }
  .confs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .conf td { padding: 4px 3px; font-size: 13px; border-top: 1px solid var(--divider-color); }
  .conf td.sd { width: 22px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .conf td.tm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; width: 100%; }
  .conf td.tm img { width: 18px; height: 18px; vertical-align: -4px; margin-right: 6px; }
  .conf td.wl { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .conf td.pt { text-align: right; width: 30px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .conf th { padding: 0 3px 2px; font-size: 10px; font-weight: 500; color: var(--secondary-text-color); text-align: right; }
  .conf tr.me td { font-weight: 700; background: var(--secondary-background-color); }
  .conf-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .conf-col h3 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: .04em; }
  .cdiv h4 { margin-bottom: 2px; }
  .conf tr[data-team] { cursor: pointer; }
  @container (max-width: 760px) { .tv-body { grid-template-columns: minmax(0, 1fr); } }
  @container (max-width: 420px) {
    .tv { padding: 4px 12px 12px; }
    .tv-head img { width: 56px; height: 56px; }
    .tv-name { font-size: 18px; }
    .confs { grid-template-columns: minmax(0, 1fr); }
  }

  .divs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .div { min-width: 0; }
  .div h4 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .drow { display: flex; justify-content: space-between; gap: 6px; font-size: 12px; padding: 4px 0;
    border-top: 1px solid var(--divider-color); }
  .drow .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .drow .r { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; flex: none; }
  .div h4 .hint { font-weight: 400; letter-spacing: 0; text-transform: none; opacity: .75; }
  .drow .r b { color: var(--primary-text-color); font-weight: 600; margin-left: 6px; }
  .drow.me .n { font-weight: 700; }
  .err { color: var(--error-color, #db4437); font-size: 13px; text-align: center; padding: 0 16px 8px; }
  .foot { font-size: 11px; color: var(--secondary-text-color); padding: 0 16px 12px; }

  /* narrow columns */
  @container (max-width: 340px) {
    .t-logo img { width: 44px; height: 44px; }
    .tname { font-size: 13px; }
    .score { font-size: 32px; }
    .mid { min-width: 46px; }
    .status { font-size: 12px; }
  }
`;

const BLOCK_DAYS = 7;              // a week on screen: Monday–Sunday
const DAY_MS = 864e5;
const MIN_COL_PX = 300;           // Auto: a day column is never narrower than this
const MIN_FIXED_COL_PX = 220;     // a chosen day count shrinks columns to this at most, then scrolls
const SINGLE_DAY_BELOW_PX = 600;  // Auto, narrower than this (phones): one day at a time
const SLIDE_MS = 500;
const fitCols = (width, min) => Math.floor((width - 32 + 12) / (min + 12));
/**
 * How many of the week's days are on screen at once. `days` is the config
 * choice: 'auto' fits as many whole columns as the width allows (one on a
 * phone); 1–7 shows that many, unless the columns would get unreadably narrow.
 */
const visFor = (width, days = 'auto', weekDays = BLOCK_DAYS) => {
  const n = Math.min(Number(days), weekDays);
  if (n >= 1) return width ? Math.max(1, Math.min(n, fitCols(width, MIN_FIXED_COL_PX))) : n;
  if (!width) return weekDays;
  return width < SINGLE_DAY_BELOW_PX ? 1 : Math.max(1, Math.min(weekDays, fitCols(width, MIN_COL_PX)));
};
/** The Monday–Sunday week holding `d`. Hockey is played most days, so the card simply works in calendar weeks. */
const weekOf = d => ({ start: addDays(startOfDay(d), -((d.getDay() + 6) % 7)), days: BLOCK_DAYS, label: '' });
/** "Preseason" / "Playoffs" when the week's games are; nothing for the regular season. */
const weekLabel = games => (games.some(g => g.playoffs) ? 'Playoffs' : games.length && games.every(g => g.preseason) ? 'Preseason' : '');
const VIEW_KEY = 'hockey-scoreboard-card:view';
const parseDayKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const FOLD_KEY = 'hockey-scoreboard-card:folded';
const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // by getDay()

class HockeyScoreboardCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._todayKey = dayKey(new Date());
    this._week = weekOf(new Date());
    this._start = this._week.start;
    this._cols = [];                      // [{ day, games, selId, summary }]
    this._standings = null;
    this._standingsAt = 0;
    this._error = null;
    this._loading = true;
    this._updated = null;
    this._scrollToToday = true;
    // Sections the viewer has folded, remembered on this device
    try { this._folded = new Set(JSON.parse(localStorage.getItem(FOLD_KEY)) || []); } catch { this._folded = new Set(); }
    // Where the viewer left off (Home Assistant rebuilds the card on every visit). Only for this tab, and only today.
    try {
      const v = JSON.parse(sessionStorage.getItem(VIEW_KEY));
      if (v?.day === this._todayKey && /^\d{4}-\d\d-\d\d$/.test(v.start)) this._restore = v;
    } catch { /* start at today */ }
    this._width = window.innerWidth;       // refined by the ResizeObserver once laid out
    this._vis = visFor(this._width, 'auto', this._week.days);
    this._buildCols();
  }

  setConfig(config) {
    this._config = { refresh_interval: 30, show_odds: true, days: 'auto', ...config };
    if (this._config.team) this._config.team = String(this._config.team).toUpperCase();
    const vis = visFor(this._width, this._config.days, this._week.days);
    if (vis !== this._vis) { this._vis = vis; this._scrollToToday = this._showingThisWeek; }
    if (this.isConnected) this._refresh();
    this._render();
  }

  set hass(hass) { this._hass = hass; }

  connectedCallback() {
    this._tickClock();
    if (this._scrollToToday) requestAnimationFrame(() => this._render()); // drawn before it was on the page
    this._refresh();
    // Fit as many whole day columns as the card's own width allows (one on a phone)
    if (!window.ResizeObserver) return;
    this._resizeObs ??= new ResizeObserver(([entry]) => {
      if (!entry.contentRect.width) return;
      this._width = entry.contentRect.width;
      const vis = visFor(this._width, this._config?.days, this._week.days);
      if (vis === this._vis || this._sliding) return;
      this._vis = vis;
      this._scrollToToday = this._showingThisWeek;
      this._render();
    });
    this._resizeObs.observe(this);
  }

  disconnectedCallback() {
    clearTimeout(this._clockTimer);
    clearTimeout(this._timer);
    clearTimeout(this._saveTimer);
    this._resizeObs?.disconnect();
  }

  getCardSize() { return 12; }
  getGridOptions() { return { columns: 'full', rows: 'auto', min_columns: 12 }; }

  static getConfigForm() {
    return {
      schema: [
        { name: 'team', selector: { select: { mode: 'dropdown', options: [{ value: '', label: 'None' }, ...TEAMS.map(([v, l]) => ({ value: v, label: l }))] } } },
        { name: 'days', selector: { select: { mode: 'dropdown', options: [{ value: 'auto', label: 'Auto (as many as fit)' },
          ...Array.from({ length: 7 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))] } } },
        { name: 'refresh_interval', selector: { number: { min: 10, max: 300, step: 5, mode: 'box', unit_of_measurement: 's' } } },
        { name: 'show_odds', selector: { boolean: {} } },
      ],
      computeLabel: s => ({ team: 'Favorite team', days: 'Days on screen', refresh_interval: 'Refresh during live games', show_odds: 'Show betting line before kickoff' }[s.name]),
      computeHelper: s => ({
        team: 'Selected automatically on days they play',
        days: 'How many days of the week show at once; swipe or scroll for the rest',
      }[s.name]),
    };
  }

  static getStubConfig() { return {}; }

  /* ── days ── */

  _buildCols() {
    const prev = new Map(this._cols.map(c => [dayKey(c.day), c]));
    this._cols = Array.from({ length: this._week.days }, (_, i) => {
      const day = addDays(this._start, i);
      return prev.get(dayKey(day)) ?? { day, games: [], selId: null, summary: null };
    });
  }

  /** Make `week` the one on screen (columns only; _setWeek also draws and loads it). */
  _useWeek(week) {
    this._week = week;
    this._start = week.start;
    this._vis = visFor(this._width, this._config?.days, week.days);
    this._buildCols();
  }

  _setWeek(week) {
    this._useWeek(week);
    this._loading = true;
    this._render();
    this._refresh();
  }

  /** The week holding `day`. */
  async _weekFor(day) { return weekOf(day); }

  async _goToday() {
    this._scrollToToday = true;
    this._setWeek(await this._weekFor(new Date()));
  }

  get _showingThisWeek() { return this._cols.some(c => dayKey(c.day) === this._todayKey); }

  _tickClock() {
    clearTimeout(this._clockTimer);
    const now = new Date();
    const el = this.shadowRoot.getElementById('clock');
    if (el) el.textContent = fmtTime(now);
    // At midnight, follow today (into the next week) if this week is what's on screen
    const key = dayKey(now);
    if (key !== this._todayKey) {
      const wasThisWeek = this._showingThisWeek;
      this._todayKey = key;
      this._scrollToToday = wasThisWeek;
      if (wasThisWeek && !this._showingThisWeek) this._goToday(); else this._render();
    }
    this._clockTimer = setTimeout(() => this._tickClock(), 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  /* ── data ── */

  async _refresh() {
    clearTimeout(this._timer);
    if (!this._calendarReady) {
      // First load: the week where the viewer left off, if there is one
      const saved = this._restore;
      this._restore = null;
      const w = await this._weekFor(saved ? parseDayKey(saved.start) : new Date());
      if (!this._calendarReady) {
        this._calendarReady = true;
        if (dayKey(w.start) !== dayKey(this._start) || w.days !== this._week.days || w.label !== this._week.label) {
          this._useWeek(w);
          this._scrollToToday = true;
        }
        if (saved) {
          this._scrollToToday = false;
          this._scrollToDay = Math.max(0, Math.min(Number(saved.col) || 0, this._cols.length - this._vis));
          if (saved.team) this._openTeam(String(saved.team), { restoring: true });
        }
      }
    }
    const start = this._start;
    const cols = this._cols;
    try {
      const standingsDue = Date.now() - this._standingsAt > STANDINGS_REFRESH_S * 1000;
      // ESPN buckets games by US Eastern date; one extra date each side covers every local time zone
      const dates = Array.from({ length: cols.length + 2 }, (_, i) => addDays(start, i - 1));
      const [events, st] = await Promise.all([
        getEvents(dates),
        standingsDue ? getJSON(STANDINGS_API).catch(() => null) : null,
      ]);
      if (start !== this._start) return; // the user moved on while this was loading
      if (st) { this._standings = parseStandings(st); this._conferences = parseConferences(st); this._standingsAt = Date.now(); }
      const games = events.map(parseGame).sort((a, b) => a.date - b.date);
      for (const c of cols) {
        c.games = games.filter(g => dayKey(g.date) === dayKey(c.day));
        this._pickGame(c);
      }
      this._week.label = weekLabel(cols.flatMap(c => c.games));
      await Promise.all(cols.map(c => this._loadSummary(c)));
      this._error = null;
      this._updated = new Date();
    } catch (e) {
      this._error = `Couldn't load scores (${e.message}). Retrying…`;
    }
    if (start !== this._start) return;
    this._loading = false;
    this._render();
    this._schedule();
  }

  _pickGame(c) {
    if (c.selId && c.games.some(g => g.id === c.selId)) return;
    const fav = this._config?.team;
    const g = (fav && c.games.find(x => x.away.abbr === fav || x.home.abbr === fav))
      || c.games.find(x => x.state === 'in')
      || c.games.find(x => x.state === 'pre')
      || c.games[0];
    c.selId = g?.id ?? null;
  }

  _selected(c) { return c.games.find(g => g.id === c.selId) ?? null; }

  /** Box score + leaders, only once a game has started (pre-game info is on the scoreboard). */
  async _loadSummary(c) {
    const g = this._selected(c);
    if (!g || g.state === 'pre') return;
    if (c.summary?.id === g.id && c.summary.final) return; // a finished game's stats don't change
    try {
      const data = await getJSON(`${API}/summary?event=${g.id}`);
      if (c.selId === g.id) c.summary = { id: g.id, data, final: g.state === 'post' };
    } catch { /* keep whatever we had; the scoreboard still shows the score */ }
  }

  _schedule() {
    const now = Date.now();
    const live = this._cols.some(c => c.games.some(g => g.state === 'in'
      || (g.state === 'pre' && g.date - now < 10 * 60000 && g.date - now > -3 * 3600000)));
    const s = this._error ? 30 : live ? Math.max(10, Number(this._config.refresh_interval) || 30) : IDLE_REFRESH_S;
    this._timer = setTimeout(() => this._refresh(), s * 1000);
  }

  /* ── render ── */

  _render() {
    if (!this._config || this._sliding) return; // the slide renders when it lands
    // Don't rebuild under an open dropdown; catch up when it closes
    const active = this.shadowRoot.activeElement;
    if (active?.tagName === 'SELECT') { this._pending = true; return; }
    const scroller = this.shadowRoot.querySelector('.cols');
    const scrollLeft = scroller?.scrollLeft;
    const single = this._vis === 1;
    const tv = this._teamView;
    if (tv && scroller) this._colsScroll = scrollLeft; // come back to the same place
    const last = addDays(this._start, this._cols.length - 1);
    const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
      <div class="top${single ? ' single-top' : ''}">
        <div class="range">${tv ? '<button class="back" id="back">‹ Back</button>' : `
          <button class="nav" id="left" aria-label="Previous week" title="Previous week">‹</button>
          <button class="nav" id="right" aria-label="Next week" title="Next week">›</button>
          <div class="wkt">${this._week.label ? `<span class="wkn">${esc(this._week.label)}</span>` : ''}${single ? '' : `<span class="wk">${md(this._start)} – ${md(last)}</span>`}</div>
          ${this._showingThisWeek ? '' : `<button class="today" id="today">${single ? 'Today' : 'This week'}</button>`}`}
        </div>
        <div class="clock" id="clock">${fmtTime(new Date())}</div>
        <button class="refresh" id="refresh" title="Refresh now">↻</button>
      </div>
      ${this._error ? `<div class="err">${esc(this._error)}</div>` : ''}
      ${tv ? this._teamViewHTML(tv) : `${this._vis < this._cols.length ? this._chipsHTML() : ''}
      <div class="cols${single ? ' single' : ''}" style="--vis:${this._vis}">${this._cols.map((c, i) => this._colHTML(c, i)).join('')}</div>`}
      ${this._updated ? `<div class="foot">Updated ${fmtTime(this._updated)}</div>` : ''}
    </ha-card>`;
    const cols = this.shadowRoot.querySelector('.cols');
    if (!cols) { this._bind(); this._saveView(); return; }
    if (this._colsScroll != null) { this._keepScroll = this._colsScroll; this._colsScroll = null; }
    // Jumps wait until the card is on screen and its columns have a width
    const step = this._colStep(cols);
    if (this._scrollToToday && step) {
      this._setScroll(cols, this._todayCol() * step);
      this._scrollToToday = false;
    } else if (this._scrollToDay != null && step) { this._setScroll(cols, this._scrollToDay * step); this._scrollToDay = null; }
    else if (this._keepScroll != null) { this._setScroll(cols, this._keepScroll); this._keepScroll = null; }
    else if (scrollLeft) this._setScroll(cols, scrollLeft);
    this._markChips();
    this._bind();
    this._saveView();
  }

  /** Remember the week, the day scrolled to and any open team page, for when the card is rebuilt. */
  _saveView() {
    if (!this._calendarReady || this._sliding) return;
    const cols = this.shadowRoot.querySelector('.cols');
    const step = cols ? this._colStep(cols) : 0;
    this._viewCol = this._scrollToDay ?? (this._scrollToToday ? this._todayCol()
      : step ? Math.round(cols.scrollLeft / step) : this._viewCol ?? 0);
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({
        day: this._todayKey, start: dayKey(this._start), col: this._viewCol, team: this._teamView ?? null,
      }));
    } catch { /* not remembered */ }
  }

  /**
   * The first column to show so today is the left-most day on screen (late in
   * the week, as far right as the week goes). The week's first day when today isn't in it.
   */
  _todayCol() {
    const t = this._cols.findIndex(c => dayKey(c.day) === this._todayKey);
    return t < 0 ? 0 : Math.min(t, this._cols.length - this._vis);
  }

  /** Width of one day column plus the gap after it (0 until the card is laid out). */
  _colStep(cols) {
    const w = cols.querySelector('.col')?.getBoundingClientRect().width;
    return w ? w + (parseFloat(getComputedStyle(cols).columnGap) || 0) : 0;
  }

  /**
   * Scroll a freshly drawn strip. Snapping is off while it's set, and the
   * position is set again a frame later: Safari otherwise re-snaps a new strip
   * back to its first day as the logos load.
   */
  _setScroll(cols, left) {
    cols.style.scrollSnapType = 'none';
    cols.scrollLeft = left;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cols.isConnected || this._sliding) return;
      cols.scrollLeft = left;
      cols.style.scrollSnapType = '';
      this._markChips();
    }));
  }

  /** One button per day of the week that jumps to it, shown when the week doesn't fit across. */
  _chipsHTML() {
    return `<div class="chips">${this._cols.map((c, i) => `<button class="chip${c.games.length ? '' : ' none'}${dayKey(c.day) === this._todayKey ? ' today' : ''}"
      data-day="${i}" aria-label="${esc(c.day.toLocaleDateString('en-US', { weekday: 'long' }))} ${fmtDate(c.day)}">
      <span class="l">${DOW_LETTERS[c.day.getDay()]}</span><span class="d">${c.day.getDate()}</span></button>`).join('')}</div>`;
  }

  /** Highlight the chips of the days currently on screen. */
  _markChips() {
    const cols = this.shadowRoot.querySelector('.cols');
    const chips = this.shadowRoot.querySelectorAll('.chip');
    if (!cols || !chips.length) return;
    const step = this._colStep(cols);
    const first = step ? Math.round(cols.scrollLeft / step) : 0;
    chips.forEach((ch, i) => ch.classList.toggle('on', i >= first && i < first + this._vis));
  }

  _colHTML(c, i) {
    const isToday = dayKey(c.day) === this._todayKey;
    const g = this._selected(c);
    return `<div class="col${isToday ? ' is-today' : ''}">
      <div class="dhead"><span class="date">${fmtDate(c.day)}${c.games.length ? `<span class="count">${c.games.length} ${c.games.length === 1 ? 'game' : 'games'}</span>` : ''}</span>
        <span class="dow">${isToday ? 'Today' : esc(c.day.toLocaleDateString('en-US', { weekday: 'long' }))}</span></div>
      ${this._pickerHTML(c, i)}
      ${g ? this._gameHTML(g, c) : ''}
    </div>`;
  }

  _pickerHTML(c, i) {
    if (!c.games.length) return `<div class="empty muted">${this._loading ? 'Loading games…' : 'No games'}</div>`;
    return `<div class="picker"><select data-col="${i}" aria-label="Game on ${fmtDate(c.day)}">
      ${c.games.map(g => `<option value="${esc(g.id)}"${g.id === c.selId ? ' selected' : ''}>${esc(gameLabel(g))}</option>`).join('')}
    </select></div>`;
  }

  /** One team's cells in the shared matchup grid; `side` picks the column. */
  _teamHTML(t, g, side) {
    const lost = g.state === 'post' && !t.winner && (g.away.winner || g.home.winner) ? ' lost' : '';
    const cell = (row, cls, html, style = '') => `<div class="${side} ${cls}" style="grid-row:${row}${style}">${html}</div>`;
    return cell(1, 't-logo', t.logo ? `<button class="logo-btn" data-team="${esc(t.id)}" aria-label="${esc(t.full)} season stats" title="Season stats"><img src="${esc(t.logo)}" alt="" loading="lazy"></button>` : '', `;--tc:${esc(t.color ?? '')}`)
      + cell(2, `tname${lost}`, `${esc(t.city)} ${esc(t.name)}`)
      + cell(3, 'trec', `${esc(t.record)}${t.split ? ` · ${esc(t.split)} ${side === 'home' ? 'home' : 'away'}` : ''}`)
      + (g.state !== 'pre' ? cell(4, `score${lost}`, esc(t.score)) : '');
  }

  _gameHTML(g, c) {
    const live = g.state === 'in';
    let html = `${g.note ? `<div class="note">${esc(g.note)}</div>` : ''}<div class="matchup">
      ${this._teamHTML(g.away, g, 'away')}
      <div class="mid vs-cell" style="grid-row:1"><div class="vs">${g.neutral ? 'vs.' : 'at'}</div>${g.state === 'pre' ? `<div class="status">${esc(statusLabel(g))}</div>` : ''}</div>
      ${g.state === 'pre' ? '' : `<div class="mid st-cell" style="grid-row:4"><div class="status${live ? ' live' : ''}">${esc(statusLabel(g))}</div></div>`}
      ${this._teamHTML(g.home, g, 'home')}
    </div>`;
    html += g.state === 'pre' ? this._preHTML(g) : this._boxHTML(g, c.summary?.id === g.id ? c.summary.data : null);
    html += this._divisionsHTML(g);
    return html;
  }

  _preHTML(g) {
    const rows = [
      ['Puck drop', `${fmtShortDay(g.date)} · ${g.timeValid ? fmtTime(g.date) : 'TBD'}`],
      g.venue && ['Venue', `${g.venue}${g.venueCity ? `, ${g.venueCity}` : ''}`],
      g.tv && ['TV', g.tv],
      this._config.show_odds && g.odds?.details && ['Line', `${g.odds.details}${g.odds.overUnder != null ? ` · O/U ${g.odds.overUnder}` : ''}`],
    ].filter(Boolean);
    return `<div class="info">${rows.map(([k, v]) => `<span class="k">${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>`;
  }

  _boxHTML(g, data) {
    let html = '';
    // Line score
    const periods = Math.max(3, g.period, ...[g.away, g.home].flatMap(t => t.linescores.map(l => l.period ?? 0)));
    if (g.away.linescores.length || g.home.linescores.length) {
      const cols = Array.from({ length: periods }, (_, i) => i + 1);
      const cell = (t, p) => { const v = t.linescores.find(l => (l.period ?? 0) === p)?.value; return v == null ? '' : String(Number(v)); };
      const row = t => `<tr><td>${esc(t.abbr)}</td>${cols.map(p => `<td>${esc(cell(t, p))}</td>`).join('')}<td>${esc(t.score)}</td></tr>`;
      html += `<table class="lines"><tr><th></th>${cols.map(p => `<th>${p <= 3 ? p : ordinal(p, g.playoffs)}</th>`).join('')}<th>T</th></tr>${row(g.away)}${row(g.home)}</table>`;
    }
    if (g.state === 'post' && g.stars.length) {
      const abbr = id => (id === g.away.id ? g.away.abbr : id === g.home.id ? g.home.abbr : '');
      html += `<div class="stars">${g.stars.map(st => `<span><span class="k">${st.label} ★</span>${esc(st.name)}${abbr(st.team) ? ` <span class="muted">${esc(abbr(st.team))}</span>` : ''}</span>`).join('')}</div>`;
    }
    if (!data) return html;

    // Team stats
    const byTeam = id => data.boxscore?.teams?.find(t => t.team?.id === id)?.statistics ?? [];
    const as = byTeam(g.away.id), hs = byTeam(g.home.id);
    const val = (list, n) => {
      const v = k => list.find(s => s.name === k)?.displayValue;
      if (n === 'powerPlay') return v('powerPlayGoals') != null ? `${v('powerPlayGoals')}/${v('powerPlayOpportunities') ?? 0}` : null;
      if (n === 'faceoffPercent') return v(n) != null ? `${v(n)}%` : null;
      return v(n);
    };
    const rows = STAT_ROWS.map(([n, label, better]) => {
      const a = val(as, n), h = val(hs, n);
      if (a == null && h == null) return '';
      let ab = '', hb = '';
      if (better) {
        const num = firstNum;
        const x = num(a), y = num(h);
        if (x != null && y != null && x !== y) { ((x > y) === (better > 0) ? (ab = ' best') : (hb = ' best')); }
      }
      return `<tr><td class="${ab}">${esc(a ?? '–')}</td><td class="lbl">${esc(label)}</td><td class="${hb}">${esc(h ?? '–')}</td></tr>`;
    }).join('');
    if (rows) html += this._foldHTML('stats', 'Team stats',
      `<table class="stats"><tr class="head"><td>${esc(g.away.abbr)}</td><td></td><td>${esc(g.home.abbr)}</td></tr>${rows}</table>`);

    // Leaders
    const leaders = id => data.leaders?.find(t => t.team?.id === id)?.leaders ?? [];
    const al = leaders(g.away.id), hl = leaders(g.home.id);
    const cell = (list, n) => {
      const top = list.find(l => l.name === n)?.leaders?.[0];
      return top ? `<span class="who">${esc(top.athlete?.shortName ?? '')}</span><br><span class="muted">${esc(top.displayValue ?? '')}</span>` : '–';
    };
    const lrows = LEADER_ROWS.filter(([n]) => al.some(l => l.name === n) || hl.some(l => l.name === n))
      .map(([n, label]) => `<tr><td>${cell(al, n)}</td><td class="lbl">${label}</td><td>${cell(hl, n)}</td></tr>`).join('');
    if (lrows) html += this._foldHTML('leaders', 'Leaders', `<table class="stats leaders">${lrows}</table>`);

    // Scoring summary, by period
    const goals = (data.plays ?? []).filter(p => p.scoringPlay);
    if (goals.length) {
      const abbr = id => (id === g.away.id ? g.away.abbr : id === g.home.id ? g.home.abbr : '');
      let per = 0;
      const rows = goals.map(p => {
        const n = p.period?.number ?? 0;
        const head = n !== per ? `<tr class="per"><td colspan="3">${esc(ordinal(n, g.playoffs))}</td></tr>` : '';
        per = n;
        // "Adam Fantilli Goal (4) Wrist Shot, assists: Kent Johnson (4), Jake Christiansen (1)"
        const text = p.text ?? '';
        const m = text.match(/^(.*?)\s+(?:Goal|Shootout Goal)\s*(\(\d+\))?/i);
        const ast = text.match(/assists?:\s*(.*)$/i)?.[1] ?? '';
        const str = STRENGTH[String(p.strength?.text ?? '').toLowerCase()] ?? (/empty net/i.test(text) ? 'EN' : '');
        return `${head}<tr><td class="t">${esc(p.clock?.displayValue ?? '')}</td><td class="tm">${esc(abbr(p.team?.id))}</td>
          <td><span class="who">${esc(m ? m[1] : text)}</span>${m?.[2] ? ` ${esc(m[2])}` : ''}${str ? `<span class="str">${str}</span>` : ''}${ast ? `<span class="ast">${esc(ast)}</span>` : ''}</td></tr>`;
      }).join('');
      html += this._foldHTML('goals', 'Scoring', `<table class="goals">${rows}</table>`);
    }
    return html;
  }

  /** A section whose heading hides / shows it. Folding applies to that section in every day column. */
  _foldHTML(key, title, body) {
    const closed = this._folded.has(key);
    return `<div><button class="fold${closed ? ' closed' : ''}" data-fold="${key}" aria-expanded="${!closed}">
      ${esc(title)} <span class="hint">(tap to ${closed ? 'expand' : 'hide'})</span></button>${closed ? '' : body}</div>`;
  }

  _divisionsHTML(g) {
    if (!this._standings) return '';
    const block = t => {
      const s = this._standings[t.id];
      if (!s) return '<div class="div"></div>';
      const top = s.division.teams.slice(0, 3);
      return `<div class="div"><h4>${esc(s.division.name)} <span class="hint">· pts</span></h4>${top.map(d =>
        `<div class="drow${d.id === t.id ? ' me' : ''}"><span class="n">${esc(d.name)}</span><span class="r">${esc(d.record)}<b>${esc(d.points)}</b></span></div>`).join('')}</div>`;
    };
    return `<div class="divs">${block(g.away)}${block(g.home)}</div>`;
  }

  /**
   * Carousel move by one week. Lays this week and the next (or previous) one
   * out as one strip, scrolls across it, then settles on the new week's first
   * day (or today, when arriving at the current week).
   */
  async _slide(dir) {
    if (this._sliding || this._finding) return;
    this._finding = true;
    const week = await this._weekFor(dir > 0 ? addDays(this._start, this._cols.length) : addDays(this._start, -1));
    this._finding = false;
    const strip = this.shadowRoot.querySelector('.cols');
    if (this._sliding || this._teamView) return;
    if (!strip?.querySelector('.col') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this._useWeek(week);
      this._scrollToDay = this._todayCol();
      this._setWeek(week);
      return;
    }
    const step = this._colStep(strip);
    const old = this._cols;
    this._useWeek(week);
    const land = this._todayCol();
    const cols = dir > 0 ? [...old, ...this._cols] : [...this._cols, ...old];
    const start = strip.scrollLeft;
    strip.classList.add('sliding');
    strip.innerHTML = cols.map(c => this._colHTML(c, -1)).join('');
    const title = this.shadowRoot.querySelector('.wkn');
    if (title) title.textContent = week.label; // the rest of the header catches up when the strip lands
    const from = dir > 0 ? start : start + this._cols.length * step;
    const to = dir > 0 ? (old.length + land) * step : land * step;
    strip.scrollLeft = from;
    this._sliding = true;
    this._loading = true;
    this._refresh(); // fetch the new week while the strip moves
    const t0 = performance.now();
    const frame = now => {
      const p = Math.min(1, (now - t0) / SLIDE_MS);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease in-out
      strip.scrollLeft = from + (to - from) * e;
      if (p < 1) { requestAnimationFrame(frame); return; }
      this._sliding = false;
      this._scrollToDay = land;
      this._render();
    };
    requestAnimationFrame(frame);
  }

  /* ── team view ── */

  async _openTeam(id, { restoring = false } = {}) {
    this._teamView = id;
    this._render();
    if (!restoring) this.shadowRoot.querySelector('ha-card')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    if (!this._teamStats || Date.now() - this._teamStatsAt > TEAM_STATS_REFRESH_S * 1000) {
      try {
        this._teamStats = parseTeamStats(await getJSON(TEAM_STATS_API));
        this._teamStatsAt = Date.now();
        this._teamStatsError = null;
      } catch (e) { this._teamStatsError = `Couldn't load season stats (${e.message}).`; }
      if (this._teamView === id) this._render();
    }
  }

  _closeTeam() {
    this._teamView = null;
    this._render();
  }

  _teamViewHTML(id) {
    const conf = this._conferences?.find(c => c.teams.some(t => t.id === id));
    const st = conf?.teams.find(t => t.id === id);
    const stats = this._teamStats;
    const me = stats?.[id];
    // Colors and names come from whatever we have: a game on screen, standings or the stats feed
    const g = this._cols.flatMap(c => c.games).find(x => x.away.id === id || x.home.id === id);
    const gt = g && (g.away.id === id ? g.away : g.home);
    const full = gt?.full || me?.full || (st ? `${st.city} ${st.name}` : '');
    const logo = gt?.logo || st?.logo || me?.logo || '';
    const div = this._standings?.[id];
    const place = div ? div.division.teams.findIndex(t => t.id === id) + 1 : 0;
    let html = `<div class="tv"><div class="tv-head" style="--tc:${esc(gt?.color ?? '')}">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
      <div><div class="tv-name">${esc(full)}</div>
        <div class="tv-sub">${esc(st?.record ?? '')}${st?.points ? ` · ${esc(st.points)} pts` : ''}${place ? ` · ${rankLabel(place)} in ${esc(div.division.name)}` : ''}</div></div>
    </div><div class="tv-body">`;

    // Season stats vs. the league leader
    if (me) {
      const all = Object.entries(stats);
      const rows = SEASON_ROWS.map(([label, key, better, dec, format]) => {
        const x = me.v[key];
        const vals = all.map(([tid, t]) => [tid, t.v[key]]).filter(([, v]) => v != null && !isNaN(v));
        if (x == null || !vals.length) return '';
        const best = vals.reduce((b, [, v]) => (better > 0 ? Math.max(b, v) : Math.min(b, v)), better > 0 ? -Infinity : Infinity);
        const rank = vals.filter(([, v]) => (better > 0 ? v > x : v < x)).length + 1;
        const tied = vals.filter(([, v]) => v === x).length > 1;
        const leaders = vals.filter(([, v]) => v === best).map(([tid]) => stats[tid]);
        const lead = leaders.length === 1
          ? `${leaders[0].logo ? `<img src="${esc(leaders[0].logo)}" alt="">` : ''}<span class="who">${esc(leaders[0].abbr)}</span>`
          : `<span class="who">${leaders.length} tied</span>`;
        return `<tr class="${rank === 1 ? 'top' : ''}"><td>${esc(label)}</td>
          <td class="v"><b>${fmtStat(x, dec, format)}</b><span class="rk">${tied ? 'T-' : ''}${rankLabel(rank)}</span></td>
          <td class="ld">${lead}${fmtStat(best, dec, format)}</td></tr>`;
      }).join('');
      html += `<div><h4>Season stats vs. league leader</h4><table class="season">
        <tr><th></th><th>${esc(me.abbr)}</th><th>Leader</th></tr>${rows}</table></div>`;
    } else {
      html += `<div class="${this._teamStatsError ? 'err' : 'empty muted'}">${esc(this._teamStatsError ?? 'Loading season stats…')}</div>`;
    }

    // East / West standings by division, numbered by division place
    if (this._conferences?.length) {
      const row = (t, i) => `<tr data-team="${esc(t.id)}" class="${t.id === id ? 'me' : ''}">
          <td class="sd">${i + 1}</td>
          <td class="tm">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}${esc(t.city)} ${esc(t.name)}</td>
          <td class="wl">${esc(t.record)}</td><td class="pt">${esc(t.points)}</td></tr>`;
      html += `<div class="confs">${this._conferences.map(c => `<div class="conf-col"><h3>${esc(c.abbr)}</h3>${c.divisions.map(d =>
        `<div class="cdiv"><h4>${esc(d.name)}</h4><table class="conf"><tr><th></th><th></th><th>W-L-OT</th><th>PTS</th></tr>${d.teams.map(row).join('')}</table></div>`).join('')}</div>`).join('')}</div>`;
    }
    return html + '</div></div>';
  }

  _bind() {
    const $ = id => this.shadowRoot.getElementById(id);
    // Arrows move a whole week; within the week, swipe / scroll or tap a day chip
    $('left')?.addEventListener('click', () => this._slide(-1));
    $('right')?.addEventListener('click', () => this._slide(1));
    $('today')?.addEventListener('click', () => this._goToday());
    const strip = this.shadowRoot.querySelector('.cols');
    strip?.addEventListener('scroll', () => {
      this._markChips();
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._saveView(), 300); // once the swipe settles
    }, { passive: true });
    this.shadowRoot.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
      const step = this._colStep(strip);
      const i = Math.min(Number(ch.dataset.day), this._cols.length - this._vis); // the last days share the final screen
      strip.scrollTo({ left: i * step, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }));
    $('back')?.addEventListener('click', () => this._closeTeam());
    this.shadowRoot.querySelectorAll('[data-fold]').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.fold;
      if (!this._folded.delete(k)) this._folded.add(k);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify([...this._folded])); } catch { /* not remembered */ }
      this._render();
    }));
    this.shadowRoot.querySelectorAll('[data-team]').forEach(el =>
      el.addEventListener('click', () => this._openTeam(el.dataset.team)));
    $('refresh')?.addEventListener('click', () => { this._cols.forEach(c => { c.summary = null; }); this._refresh(); });
    this.shadowRoot.querySelectorAll('select[data-col]').forEach(sel => {
      const c = this._cols[Number(sel.dataset.col)];
      sel.addEventListener('change', async () => {
        c.selId = sel.value;
        sel.blur();
        this._render();
        await this._loadSummary(c);
        this._render();
      });
      sel.addEventListener('blur', () => { if (this._pending) { this._pending = false; setTimeout(() => this._render(), 0); } });
    });
  }
}

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, HockeyScoreboardCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: 'Hockey Scoreboard Card',
  description: 'NHL scores a week at a time, with team stats, scoring summaries, three stars and division standings.',
  preview: true,
  documentationURL: 'https://github.com/AOPW-llc/hockey-scoreboard-card',
});

console.info(`%c HOCKEY-SCOREBOARD-CARD %c v${VERSION} `,
  'color:#fff;background:#111;font-weight:bold', 'color:#111;background:#fff');
