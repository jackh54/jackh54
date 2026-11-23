// Generates assets/stats.svg from the GitHub GraphQL API. Run by the profile workflow.
import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.env.USERNAME || "jackh54";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

// ---- contributions (all years) ----
const { user: u } = await gql(
  `query($l:String!){ user(login:$l){ contributionsCollection{ contributionYears } } }`,
  { l: USER }
);
const days = [];
let total = 0;
for (const year of u.contributionsCollection.contributionYears) {
  const d = await gql(
    `query($l:String!,$f:DateTime!,$t:DateTime!){ user(login:$l){ contributionsCollection(from:$f,to:$t){
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`,
    { l: USER, f: `${year}-01-01T00:00:00Z`, t: `${year}-12-31T23:59:59Z` }
  );
  const cal = d.user.contributionsCollection.contributionCalendar;
  total += cal.totalContributions;
  for (const w of cal.weeks) for (const day of w.contributionDays) days.push(day);
}
const today = new Date().toISOString().slice(0, 10);
const byDate = [...new Map(days.map((d) => [d.date, d.contributionCount])).entries()]
  .filter(([date]) => date <= today)
  .sort(([a], [b]) => (a < b ? -1 : 1));

let longest = 0, run = 0;
for (const [, c] of byDate) { run = c > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
let i = byDate.length - 1;
if (i >= 0 && byDate[i][1] === 0) i--; // today not counted yet doesn't break the streak
for (; i >= 0 && byDate[i][1] > 0; i--) current++;

const last364 = byDate.slice(-364);
const yearTotal = last364.reduce((s, [, c]) => s + c, 0);
const weekly = [];
for (let w = 0; w < last364.length; w += 7) weekly.push(last364.slice(w, w + 7).reduce((s, [, c]) => s + c, 0));

// ---- languages (public, non-fork repos) ----
const langs = new Map();
let cursor = null;
do {
  const d = await gql(
    `query($l:String!,$c:String){ user(login:$l){ repositories(first:100, after:$c, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
      pageInfo{ hasNextPage endCursor }
      nodes{ languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } } } } } }`,
    { l: USER, c: cursor }
  );
  const r = d.user.repositories;
  for (const n of r.nodes)
    for (const e of n.languages.edges) {
      const cur = langs.get(e.node.name) || { size: 0, color: e.node.color || "#7aa2f7" };
      cur.size += e.size;
      langs.set(e.node.name, cur);
    }
  cursor = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
} while (cursor);
const skip = new Set(["HTML", "CSS", "SCSS", "Shell", "Batchfile", "Dockerfile", "Makefile", "Procfile"]);
const top = [...langs.entries()].filter(([n]) => !skip.has(n)).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const langTotal = top.reduce((s, [, v]) => s + v.size, 0) || 1;

// ---- render ----
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const W = 900, H = 300;

// weekly area chart
const cx = 40, cy = 200, cw = 500, ch = 70;
const max = Math.max(1, ...weekly);
const pts = weekly.map((v, k) => [cx + (k * cw) / Math.max(1, weekly.length - 1), cy + ch - (v / max) * ch]);
const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
const area = `${line} L${cx + cw} ${cy + ch} L${cx} ${cy + ch} Z`;

// language bar + legend
let bx = 600;
const bw = 260;
const bar = top.map(([n, v]) => {
  const w = (v.size / langTotal) * bw;
  const r = `<rect x="${bx.toFixed(1)}" y="92" width="${w.toFixed(1)}" height="10" fill="${v.color}"/>`;
  bx += w;
  return r;
}).join("");
const legend = top.map(([n, v], k) => {
  const x = 600 + (k % 2) * 135, y = 130 + Math.floor(k / 2) * 26;
  return `<g class="fade" style="animation-delay:${0.2 + k * 0.1}s"><circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${v.color}"/>
    <text x="${x + 16}" y="${y}" class="sans" font-size="13" fill="#a9b1d6">${esc(n)} <tspan fill="#565f89">${((v.size / langTotal) * 100).toFixed(1)}%</tspan></text></g>`;
}).join("");

const stat = (x, value, label, color, delay) => `
  <g class="fade" style="animation-delay:${delay}s">
    <text x="${x}" y="98" class="sans" font-size="34" font-weight="800" fill="${color}">${value}</text>
    <text x="${x}" y="122" class="mono" font-size="12" fill="#565f89">${label}</text>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#131a33"/></linearGradient>
    <linearGradient id="ac" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7aa2f7"/><stop offset="1" stop-color="#bb9af7"/></linearGradient>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bb9af7" stop-opacity="0.35"/><stop offset="1" stop-color="#7aa2f7" stop-opacity="0"/></linearGradient>
    <clipPath id="bar"><rect x="600" y="92" width="${bw}" height="10" rx="5"/></clipPath>
    <style>
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      .sans{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
      .fade{opacity:0;animation:fade .6s ease-out forwards}
      @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .draw{stroke-dasharray:2000;stroke-dashoffset:2000;animation:draw 2.2s ease-out .3s forwards}
      @keyframes draw{to{stroke-dashoffset:0}}
      .area{opacity:0;animation:fade 1s ease-out 1.6s forwards}
      .flame{animation:pulse 1.4s ease-in-out infinite alternate;transform-origin:center;transform-box:fill-box}
      @keyframes pulse{from{transform:scale(.9)}to{transform:scale(1.1)}}
    </style>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="#7aa2f7" stroke-opacity="0.12"/>

  <text x="40" y="44" class="mono" font-size="13" fill="#7aa2f7">$ <tspan fill="#a9b1d6">gh stats ${esc(USER)}</tspan></text>

  ${stat(40, fmt(total), "total contributions", "#c0caf5", 0)}
  ${stat(220, `${current}<tspan class="flame" font-size="26"> 🔥</tspan>`, "current streak (days)", "#bb9af7", 0.1)}
  ${stat(400, longest, "longest streak (days)", "#7aa2f7", 0.2)}

  <text x="40" y="186" class="mono" font-size="12" fill="#565f89">last 52 weeks · ${fmt(yearTotal)} contributions</text>
  <path d="${area}" fill="url(#fill)" class="area"/>
  <path d="${line}" fill="none" stroke="url(#ac)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" class="draw"/>
  <line x1="${cx}" y1="${cy + ch + 0.5}" x2="${cx + cw}" y2="${cy + ch + 0.5}" stroke="#565f89" stroke-opacity="0.3"/>

  <line x1="570" y1="40" x2="570" y2="260" stroke="#565f89" stroke-opacity="0.25"/>
  <text x="600" y="72" class="mono" font-size="13" fill="#7aa2f7">top languages</text>
  <g clip-path="url(#bar)"><rect x="600" y="92" width="${bw}" height="10" fill="#1f2335"/>${bar}</g>
  ${legend}

  <text x="${W - 30}" y="${H - 18}" text-anchor="end" class="mono" font-size="10" fill="#3b4261">updated ${today}</text>
</svg>`;

mkdirSync("assets", { recursive: true });
writeFileSync("assets/stats.svg", svg);
console.log({ total, current, longest, yearTotal, top: top.map(([n]) => n) });
