// scripts/generate-stats.js
// Holt deine Contributions per GitHub GraphQL-API und baut daraus zwei SVGs:
//   stats-streak.svg   (Total / Current Streak / Longest Streak)
//   stats-activity.svg (Flaechendiagramm der letzten 90 Tage mit Peak-Punkt)

const fs = require('fs');

const USER = process.env.GH_USER;
const TOKEN = process.env.GITHUB_TOKEN;

const GRAPH_DAYS = 90;
const C = {
  bg: '#1a1b27',
  grid: '#2f334d',
  title: '#70a5fd',
  text: '#a9b1d6',
  muted: '#565f89',
  blue: '#7aa2f7',
  orange: '#ff9e64',
};
const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- 1. Daten holen ----------
async function fetchDays() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'fgdhc-stats',
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  if (!res.ok) throw new Error(`GitHub API antwortete mit ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  return weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }));
}

// ---------- 2. Kennzahlen berechnen ----------
function computeStats(rawDays, todayStr) {
  const days = rawDays
    .filter((d) => d.date <= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const total = days.reduce((sum, d) => sum + d.count, 0);

  // Longest Streak: laengste Folge von Tagen mit mindestens 1 Contribution
  let longest = { len: 0, start: null, end: null };
  let run = null;
  for (const d of days) {
    if (d.count > 0) {
      if (!run) run = { len: 0, start: d.date, end: d.date };
      run.len += 1;
      run.end = d.date;
      if (run.len > longest.len) longest = { ...run };
    } else {
      run = null;
    }
  }

  // Current Streak: rueckwaerts zaehlen; ein leerer "heute"-Tag bricht sie noch nicht
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i -= 1;
  const current = { len: 0, start: null, end: null };
  while (i >= 0 && days[i].count > 0) {
    if (!current.end) current.end = days[i].date;
    current.start = days[i].date;
    current.len += 1;
    i -= 1;
  }

  // Peak: Tag mit den meisten Contributions in den letzten GRAPH_DAYS Tagen
  const graph = days.slice(-GRAPH_DAYS);
  let peakIdx = -1;
  graph.forEach((d, idx) => {
    if (d.count > 0 && (peakIdx === -1 || d.count >= graph[peakIdx].count)) peakIdx = idx;
  });

  return { total, current, longest, graph, peakIdx };
}

// ---------- 3. SVGs bauen ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmtDay = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const fmtRange = (a, b) => (a ? `${fmtDay(a)} – ${fmtDay(b)}` : '–');

function renderStreakSvg(s) {
  const col = (cx, num, label, sub, labelColor, numColor) => `
  <text x="${cx}" y="64" text-anchor="middle" font-size="32" font-weight="700" fill="${numColor}">${esc(num)}</text>
  <text x="${cx}" y="90" text-anchor="middle" font-size="13" fill="${labelColor}">${esc(label)}</text>
  <text x="${cx}" y="108" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(sub)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="130" viewBox="0 0 600 130" font-family="${FONT}" role="img" aria-label="Contribution streaks">
  <title>Contribution streaks</title>
  <rect width="600" height="130" rx="10" fill="${C.bg}"/>
  <line x1="200" y1="28" x2="200" y2="102" stroke="${C.grid}"/>
  <line x1="400" y1="28" x2="400" y2="102" stroke="${C.grid}"/>${col(100, s.total, 'Total Contributions', 'Last 12 months', C.text, C.blue)}${col(300, s.current.len, 'Current Streak', fmtRange(s.current.start, s.current.end), C.orange, C.orange)}${col(500, s.longest.len, 'Longest Streak', fmtRange(s.longest.start, s.longest.end), C.text, C.blue)}
</svg>
`;
}

function renderActivitySvg(s) {
  const W = 600;
  const H = 200;
  const left = 40;
  const right = 584;
  const top = 56;
  const bottom = 160;

  const n = s.graph.length;
  const maxCount = s.peakIdx >= 0 ? s.graph[s.peakIdx].count : 0;
  const yTop = Math.max(4, Math.ceil(maxCount / 4) * 4);
  const x = (i) => (n > 1 ? left + (i / (n - 1)) * (right - left) : left);
  const y = (v) => bottom - (v / yTop) * (bottom - top);

  const pts = s.graph.map((d, i) => [x(i), y(d.count)]);
  const line = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${left},${bottom} ${line} ${x(n - 1).toFixed(1)},${bottom}`;

  let grid = '';
  for (let k = 0; k <= 4; k += 1) {
    const v = (yTop / 4) * k;
    grid += `\n  <line x1="${left}" y1="${y(v).toFixed(1)}" x2="${right}" y2="${y(v).toFixed(1)}" stroke="${C.grid}"/>`;
    grid += `\n  <text x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${C.muted}">${v}</text>`;
  }

  let months = '';
  s.graph.forEach((d, i) => {
    if (d.date.endsWith('-01')) {
      const m = Number(d.date.split('-')[1]);
      months += `\n  <text x="${x(i).toFixed(1)}" y="182" font-size="10" fill="${C.muted}">${MONTHS[m - 1]}</text>`;
    }
  });

  let peak = '';
  if (s.peakIdx >= 0) {
    const [px, py] = pts[s.peakIdx];
    const d = s.graph[s.peakIdx];
    const anchor = px > right - 110 ? 'end' : 'start';
    const tx = anchor === 'end' ? px - 8 : px + 8;
    peak = `
  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${C.orange}"/>
  <text x="${tx.toFixed(1)}" y="${(py - 8).toFixed(1)}" text-anchor="${anchor}" font-size="11" fill="${C.orange}">Peak: ${d.count} · ${esc(fmtDay(d.date))}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="Contribution activity der letzten ${GRAPH_DAYS} Tage">
  <title>Contribution Activity</title>
  <rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
  <text x="24" y="30" font-size="14" font-weight="600" fill="${C.title}">Contribution Activity</text>${grid}${months}
  <polygon points="${area}" fill="${C.blue}" fill-opacity="0.18"/>
  <polyline points="${line}" fill="none" stroke="${C.blue}" stroke-width="2" stroke-linejoin="round"/>${peak}
</svg>
`;
}

// ---------- 4. Ablauf ----------
async function main() {
  if (!USER || !TOKEN) throw new Error('GH_USER und GITHUB_TOKEN muessen gesetzt sein');
  const days = await fetchDays();
  const todayStr = new Date().toISOString().slice(0, 10);
  const stats = computeStats(days, todayStr);

  fs.writeFileSync('stats-streak.svg', renderStreakSvg(stats));
  fs.writeFileSync('stats-activity.svg', renderActivitySvg(stats));
  console.log(
    `OK: total=${stats.total}, current=${stats.current.len}, longest=${stats.longest.len}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { computeStats, renderStreakSvg, renderActivitySvg };
