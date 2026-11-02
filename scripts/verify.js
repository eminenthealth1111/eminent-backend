// Runs every agent through one test command and reports pass or fail per agent.
// Uses a throwaway state file so your real Approval Queue is never touched.
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.EMINENT_STATE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eminent-verify-')), 'state.json');

const registry = require('../lib/registry');
const router = require('../lib/router');
const approval = require('../lib/approval');

const reg = registry.withStatus(registry.load());
const NF = 'not found';
const rows = [];
let agentsPass = 0;

reg.agents.forEach((a) => {
  const checks = {};
  checks.photo = a.photoFound;
  checks.prompt = a.promptFound;
  const owner = registry.resolveOwner(reg, a.owner);
  checks.owner = !!owner;

  approval.setOutboundEnabled(true);
  const before = approval.list().length;
  const r = router.route({ agent: a.id, command: `Send a status email to the client for ${a.name}`, type: 'email' });
  const q = approval.list();
  // Outbound must be held: queued, pending, never executed.
  checks.outboundBlocked = r.status === 'queued' && q.length === before + 1 && q[q.length - 1].status === 'pending' && q[q.length - 1].executed === false;

  // With the master switch OFF, outbound must be refused outright.
  approval.setOutboundEnabled(false);
  const off = router.route({ agent: a.id, command: 'Send a status email', type: 'email' });
  checks.switchStopsAll = off.status === 'blocked' && approval.list().length === before + 1;
  approval.setOutboundEnabled(true);

  const pass = Object.values(checks).every(Boolean);
  if (pass) agentsPass += 1;
  rows.push({ name: a.name, pass, checks });
});

// Council seats: record present and escalates to Aalia.
const seatsOk = reg.council.filter((c) => c.escalationTarget === reg.owner.id && registry.resolveOwner(reg, c.id));
const seatPhotos = reg.council.filter((c) => c.photoFound).length;

// Refund must be blocked, unmatched must escalate.
const refund = router.route({ agent: 'crown', command: 'Issue a refund', type: 'refund' });
const stray = router.route({ command: 'zzzz qqqq' });

console.log('\nAGENT       PHOTO  PROMPT  OWNER  OUTBOUND-HELD  SWITCH-OFF  RESULT');
rows.forEach((r) => {
  const f = (b) => (b ? 'ok  ' : 'FAIL');
  console.log(`${r.name.padEnd(11)} ${f(r.checks.photo)}   ${f(r.checks.prompt)}    ${f(r.checks.owner)}   ${f(r.checks.outboundBlocked)}           ${f(r.checks.switchStopsAll)}        ${r.pass ? 'PASS' : 'FAIL'}`);
});

const photoFound = reg.agents.filter((a) => a.photoFound).length;
const nfFields = new Set();
[...reg.agents, ...reg.council].forEach((x) => Object.entries(x).forEach(([k, v]) => { if (v === NF) nfFields.add(k); }));

console.log(`\nAgents passing all checks: ${agentsPass} of ${reg.agents.length}`);
console.log(`Council seats wired: ${seatsOk.length} of ${reg.council.length}`);
console.log(`Agent photos found: ${photoFound} of ${reg.agents.length}. Council photos found: ${seatPhotos} of ${reg.council.length}`);
console.log(`Refund blocked: ${refund.status === 'blocked' ? 'yes' : 'NO'}. Unmatched command escalates to Aalia: ${stray.status === 'escalated' ? 'yes' : 'NO'}`);
console.log(`Fields marked "not found": ${[...nfFields].join(', ')}`);

const hardFail = rows.some((r) => !r.checks.owner || !r.checks.outboundBlocked || !r.checks.switchStopsAll || !r.checks.prompt) || refund.status !== 'blocked' || stray.status !== 'escalated';
process.exit(hardFail ? 1 : 0);
