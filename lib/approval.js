// Approval Queue and master outbound switch.
// Nothing here sends anything. Approving an item records Aalia's decision.
// Executors (Resend, Vapi, PayPal, Stripe) are a separate step.
const crypto = require('crypto');
const state = require('./state');

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function isOutboundEnabled() {
  return state.read().outboundEnabled;
}

function setOutboundEnabled(enabled) {
  const s = state.read();
  s.outboundEnabled = !!enabled;
  state.write(s);
  return s.outboundEnabled;
}

function enqueue({ agentId, ownerId, type, command, payload }) {
  const s = state.read();
  const item = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    agentId,
    ownerId,
    type: type || 'unspecified',
    command,
    payload: payload || null,
    status: 'pending',
    decidedAt: null,
    executed: false,
  };
  s.queue.push(item);
  state.write(s);
  return item;
}

function list(status) {
  const q = state.read().queue;
  return status ? q.filter((i) => i.status === status) : q;
}

function decide(id, decision) {
  const s = state.read();
  if (decision === 'approved' && !s.outboundEnabled) {
    throw fail(423, 'Master outbound switch is OFF. Turn it on before approving anything.');
  }
  const item = s.queue.find((i) => i.id === id);
  if (!item) throw fail(404, 'Approval item not found');
  if (item.status !== 'pending') throw fail(409, `Item already ${item.status}`);
  item.status = decision;
  item.decidedAt = new Date().toISOString();
  state.write(s);
  return item;
}

module.exports = { isOutboundEnabled, setOutboundEnabled, enqueue, list, decide };
