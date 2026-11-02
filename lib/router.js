// Command router. Picks the agent, checks the owner, and sends anything
// outbound to the Approval Queue. Unmatched commands escalate to Aalia.
// Agents are UI ONLY right now, so a routed command returns a dispatch
// record. It does not call any model.
const registry = require('./registry');
const approval = require('./approval');

const OUTBOUND_TYPES = new Set(['email', 'sms', 'call', 'message', 'post', 'publish', 'charge', 'payment', 'transfer', 'invoice']);
// Fail-safe: if the text sounds outbound, it goes to the queue. This can over-queue. That is intended.
const OUTBOUND_WORDS = /\b(send|email|e-mail|text|sms|call|dm|message|post|publish|charge|bill|invoice|pay|payment|transfer|wire)\b/i;
const REFUND = /\brefund(s|ed|ing)?\b/i;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'please', 'need', 'want', 'make', 'create', 'draft', 'write', 'about', 'into', 'our', 'your', 'a', 'to', 'of', 'on']);

const stem = (w) => w.slice(0, 5);
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];

function score(agent, text) {
  const roleStems = new Set(words(agent.role).filter((w) => !STOP.has(w)).map(stem));
  const q = new Set(words(text).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem));
  let n = 0;
  q.forEach((s) => { if (roleStems.has(s)) n += 1; });
  return n;
}

function pickAgent(reg, { agent, role, command }) {
  if (agent) {
    const a = registry.findAgent(reg, agent);
    return a ? { agent: a, by: 'agent' } : { error: `Unknown agent "${agent}"` };
  }
  const text = role || command;
  const ranked = reg.agents.map((a) => ({ a, s: score(a, text) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  if (!ranked.length) return { agent: null, by: 'none' };
  if (ranked.length > 1 && ranked[0].s === ranked[1].s) return { agent: null, by: 'ambiguous', candidates: ranked.filter((x) => x.s === ranked[0].s).map((x) => x.a.id) };
  return { agent: ranked[0].a, by: role ? 'role' : 'command' };
}

function route(input) {
  const { command, type, payload } = input || {};
  if (!command || typeof command !== 'string') return { http: 400, status: 'error', error: 'command is required' };

  const reg = registry.load();

  if (REFUND.test(command) || String(type).toLowerCase() === 'refund') {
    return { http: 403, status: 'blocked', reason: 'No refund endpoint exists. Refunds are handled by Aalia directly.' };
  }

  const picked = pickAgent(reg, input);
  if (picked.error) return { http: 404, status: 'error', error: picked.error };

  if (!picked.agent) {
    return {
      http: 200,
      status: 'escalated',
      reason: picked.by === 'ambiguous' ? `Command matches several agents (${picked.candidates.join(', ')}). Sent up to Aalia.` : 'No agent matched. Sent up to Aalia.',
      escalatedTo: reg.owner.id,
    };
  }

  const agent = picked.agent;
  const owner = registry.resolveOwner(reg, agent.owner);
  if (!owner) {
    return { http: 500, status: 'error', error: `Owner "${agent.owner}" for ${agent.name} does not resolve to a council seat` };
  }

  const dispatch = { agent: agent.id, name: agent.name, role: agent.role, owner: owner.id, ownerName: owner.name, routedBy: picked.by, promptFile: agent.promptFile, agentStatus: agent.status };
  const outbound = OUTBOUND_TYPES.has(String(type).toLowerCase()) || OUTBOUND_WORDS.test(command);

  if (!outbound) return { http: 200, status: 'routed', dispatch, escalation: registry.escalationChain(reg, agent) };

  if (!approval.isOutboundEnabled()) {
    return { http: 423, status: 'blocked', reason: 'Master outbound switch is OFF. Nothing outbound moves.', dispatch };
  }

  const item = approval.enqueue({ agentId: agent.id, ownerId: owner.id, type: type || 'inferred-from-text', command, payload });
  return { http: 202, status: 'queued', reason: 'Outbound action held for Aalia in the Approval Queue. Nothing was sent.', approvalId: item.id, dispatch, escalation: registry.escalationChain(reg, agent) };
}

module.exports = { route };
