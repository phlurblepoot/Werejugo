#!/usr/bin/env node
// Roadmap tracker for docs/superpowers/specs/2026-09-26-completion-roadmap.md.
//
//   node scripts/roadmap.mjs                        print where the project stands (used by the SessionStart hook)
//   node scripts/roadmap.mjs --check                validate the roadmap; exit 1 on problems
//   node scripts/roadmap.mjs --check --changed-since origin/main
//                                                   also fail if app code changed since <ref> without a roadmap update
//
// No dependencies; parses the markdown conventions described in the roadmap's "How tracking works".

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROADMAP_PATH = "docs/superpowers/specs/2026-09-26-completion-roadmap.md";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATES = ["Not started", "Planned", "In progress", "In review", "Done", "Dropped"];
const LOG_TYPES = ["Done", "Changed", "Decided", "Note"];
const STATUS_FIELDS = ["Current milestone", "Current phase", "Next step", "Blocked on", "Last updated"];
// Paths whose changes must be accompanied by a roadmap update.
const APP_PATHS = [/^backend\//, /^frontend\//, /^docker-compose\.yml$/, /^unraid\//, /^\.github\/workflows\//];

export function parseRoadmap(text) {
  const lines = text.split("\n");
  const status = {};
  const milestones = [];
  const phases = [];
  const log = [];
  let section = null; // "status" | "milestones" | "log" | null
  let milestone = null;
  let phase = null;
  let logDate = null;

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.includes("<!-- status:begin -->")) { section = "status"; return; }
    if (line.includes("<!-- status:end -->")) { section = null; return; }
    if (section === "status") {
      const m = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|\s*$/);
      if (m) status[m[1]] = m[2];
      return;
    }
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      phase = null;
      section = /^4\. Milestones/.test(h2[1]) ? "milestones" : /^8\. Progress/.test(h2[1]) ? "log" : null;
      return;
    }
    if (section === "milestones") {
      const ms = line.match(/^### Milestone (\d+) — (.+)$/);
      if (ms) { milestone = { id: ms[1], title: ms[2], line: lineNo }; milestones.push(milestone); phase = null; return; }
      const ph = line.match(/^#### (\d+\.\d+) (.+?) — (S|M|L|XL)\s*$/);
      if (ph) {
        phase = { id: ph[1], title: ph[2], size: ph[3], milestone: milestone?.id, line: lineNo, state: null, plan: null, pr: null, items: [] };
        phases.push(phase);
        return;
      }
      if (!phase) return;
      const st = line.match(/^\*\*Status:\*\* (.+?) · \*\*Plan:\*\* (.+?) · \*\*PR:\*\* (.+?)\s*$/);
      if (st) { phase.state = st[1]; phase.plan = st[2]; phase.pr = st[3]; return; }
      const item = line.match(/^\s*- \[( |x|X)\] (.+)$/);
      if (item) {
        const body = item[2];
        phase.items.push({ done: item[1] !== " ", dropped: /^~~.+~~/.test(body), text: body, line: lineNo });
      }
      return;
    }
    if (section === "log") {
      const d = line.match(/^### (\d{4}-\d{2}-\d{2})\s*$/);
      if (d) { logDate = d[1]; return; }
      const e = line.match(/^- \*\*(\w+)\*\* — (.+)$/);
      if (e) log.push({ date: logDate, type: e[1], text: e[2], line: lineNo });
    }
  });
  return { status, milestones, phases, log };
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const empty = (s) => !s || s === "—" || s === "-";

export function checkRoadmap(rm, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = [];
  const warnings = [];
  const { status, phases, milestones, log } = rm;

  for (const f of STATUS_FIELDS) if (empty(status[f])) errors.push(`Status block is missing "${f}"`);
  const updated = status["Last updated"];
  if (updated && !isDate(updated)) errors.push(`Status "Last updated" must be YYYY-MM-DD, got "${updated}"`);
  // One day of slack for time zones.
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  if (isDate(updated) && updated > tomorrow) errors.push(`Status "Last updated" (${updated}) is in the future`);

  if (!milestones.length) errors.push("No milestones found (expected '### Milestone N — …' under '## 4. Milestones')");
  if (!phases.length) errors.push("No phases found (expected '#### X.Y Title — S|M|L|XL')");

  const current = phases.find((p) => p.id === status["Current phase"]);
  if (status["Current phase"] && !current) errors.push(`Status "Current phase" (${status["Current phase"]}) does not match any phase id`);
  if (current && status["Current milestone"] && !status["Current milestone"].startsWith(`Milestone ${current.milestone} `)) {
    errors.push(`Status "Current milestone" does not match phase ${current.id} (which is in Milestone ${current.milestone})`);
  }

  const seen = new Set();
  for (const p of phases) {
    const where = `Phase ${p.id} (line ${p.line})`;
    if (seen.has(p.id)) errors.push(`${where}: duplicate phase id`);
    seen.add(p.id);
    if (!p.state) { errors.push(`${where}: missing "**Status:** … · **Plan:** … · **PR:** …" line`); continue; }
    if (!STATES.includes(p.state)) errors.push(`${where}: unknown state "${p.state}" (use one of: ${STATES.join(", ")})`);
    if (["Planned", "In progress", "In review", "Done"].includes(p.state) && empty(p.plan)) errors.push(`${where}: state "${p.state}" needs a Plan link`);
    if (["In review", "Done"].includes(p.state) && empty(p.pr)) errors.push(`${where}: state "${p.state}" needs a PR link`);
    const open = p.items.filter((it) => !it.done && !it.dropped);
    if (p.state === "Done" && open.length) errors.push(`${where}: marked Done but ${open.length} item(s) are unticked (tick them or strike them through as dropped)`);
    if (p.state === "Not started" && p.items.some((it) => it.done)) warnings.push(`${where}: has ticked items but is still "Not started"`);
    if (p.state === "Dropped" && !log.some((e) => e.text.includes(p.id))) warnings.push(`${where}: Dropped, but no §8 log entry mentions ${p.id}`);
    if (!p.items.length && p.state !== "Dropped") warnings.push(`${where}: has no checklist items`);
  }
  const active = phases.filter((p) => ["In progress", "In review"].includes(p.state));
  if (active.length > 2) warnings.push(`${active.length} phases are in progress/review at once: ${active.map((p) => p.id).join(", ")}`);
  if (current?.state === "Done") warnings.push(`Current phase ${current.id} is Done — advance the Status block to the next phase`);

  if (!log.length) errors.push('§8 "Progress & change log" has no entries');
  let prev = null;
  for (const e of log) {
    if (!e.date) { errors.push(`Log entry on line ${e.line} is not under a "### YYYY-MM-DD" heading`); continue; }
    if (!isDate(e.date)) errors.push(`Log heading "${e.date}" is not a valid date`);
    if (prev && e.date > prev) errors.push(`Log dates must be newest first (${e.date} appears after ${prev})`);
    prev = e.date;
    if (!LOG_TYPES.includes(e.type)) errors.push(`Log entry on line ${e.line}: unknown type "${e.type}" (use ${LOG_TYPES.join(", ")})`);
  }
  const newest = log.find((e) => e.date)?.date;
  if (newest && isDate(updated) && newest > updated) errors.push(`Status "Last updated" (${updated}) is older than the newest log entry (${newest})`);

  return { errors, warnings };
}

export function checkChangedSince(ref, cwd = ROOT) {
  let files;
  try {
    files = execFileSync("git", ["diff", "--name-only", `${ref}...HEAD`], { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (err) {
    return [`Could not diff against "${ref}": ${err.message.split("\n")[0]}`];
  }
  const appChanged = files.filter((f) => APP_PATHS.some((re) => re.test(f)));
  if (appChanged.length && !files.includes(ROADMAP_PATH)) {
    return [`App code changed since ${ref} (${appChanged.length} file(s), e.g. ${appChanged[0]}) but ${ROADMAP_PATH} was not updated`];
  }
  return [];
}

function summary(rm, problems) {
  const { status, milestones, phases, log } = rm;
  const out = [];
  out.push(`WEREJUGO ROADMAP — ${ROADMAP_PATH}`);
  out.push("Source of truth for where the project is. Follow CLAUDE.md \"Roadmap discipline\"; update the roadmap in the same commit as the work.");
  out.push("");
  for (const f of STATUS_FIELDS) out.push(`${f}: ${status[f] ?? "(missing)"}`);
  out.push("");
  out.push("Progress:");
  for (const m of milestones) {
    const ps = phases.filter((p) => p.milestone === m.id);
    const items = ps.flatMap((p) => p.items.filter((it) => !it.dropped));
    const done = ps.filter((p) => p.state === "Done").length;
    const tag = ps.map((p) => `${p.id}:${abbrev(p.state)}`).join(" ");
    out.push(`  M${m.id} ${m.title.split(":")[0]} — ${done}/${ps.length} phases done, ${items.filter((i) => i.done).length}/${items.length} items  [${tag}]`);
  }
  const current = phases.find((p) => p.id === status["Current phase"]);
  if (current) {
    const open = current.items.filter((it) => !it.done && !it.dropped);
    out.push("");
    out.push(`Current phase ${current.id} ${current.title} — ${current.state} · Plan: ${current.plan} · PR: ${current.pr}`);
    out.push(`  Open items (${open.length}):`);
    for (const it of open.slice(0, 12)) out.push(`  - [ ] ${truncate(it.text, 150)}`);
    if (open.length > 12) out.push(`  … and ${open.length - 12} more`);
  }
  const others = phases.filter((p) => p !== current && ["Planned", "In progress", "In review"].includes(p.state));
  if (others.length) out.push(`Other active phases: ${others.map((p) => `${p.id} (${p.state})`).join(", ")}`);
  out.push("");
  out.push("Recent log (§8):");
  for (const e of log.slice(0, 5)) out.push(`  ${e.date} ${e.type} — ${truncate(e.text, 160)}`);
  if (problems.length) {
    out.push("");
    out.push("⚠ Roadmap check problems (fix these in the roadmap):");
    for (const p of problems) out.push(`  - ${p}`);
  }
  return out.join("\n");
}

const abbrev = (s) => ({ "Not started": "todo", Planned: "planned", "In progress": "WIP", "In review": "review", Done: "done", Dropped: "dropped" })[s] ?? "?";
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function main(argv) {
  let text;
  try {
    text = readFileSync(resolve(ROOT, ROADMAP_PATH), "utf8");
  } catch {
    console.log(`Roadmap not found at ${ROADMAP_PATH}.`);
    return argv.includes("--check") ? 1 : 0;
  }
  const rm = parseRoadmap(text);
  const { errors, warnings } = checkRoadmap(rm);
  const since = argv.indexOf("--changed-since");
  if (since !== -1) errors.push(...checkChangedSince(argv[since + 1] ?? "origin/main"));

  if (argv.includes("--check")) {
    for (const w of warnings) console.log(`warning: ${w}`);
    for (const e of errors) console.log(`error: ${e}`);
    console.log(errors.length ? `Roadmap check failed (${errors.length} error(s)).` : `Roadmap check passed (${rm.phases.length} phases, ${rm.log.length} log entries).`);
    return errors.length ? 1 : 0;
  }
  console.log(summary(rm, [...errors, ...warnings]));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
