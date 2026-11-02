// Reads agents.json, the only place agent identity lives.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OWNER_ID = 'aalia-ameen';

function load() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'agents.json'), 'utf8'));
}

// Serve photo paths from disk presence so the UI and verify step know the truth.
function photoFound(photoPath) {
  if (!photoPath) return false;
  return fs.existsSync(path.join(ROOT, photoPath.replace(/^\//, '')));
}

function promptFound(promptFile) {
  if (!promptFile) return false;
  const p = path.join(ROOT, promptFile);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}

function withStatus(reg) {
  return {
    ...reg,
    council: reg.council.map((c) => ({ ...c, photoFound: photoFound(c.photo) })),
    agents: reg.agents.map((a) => ({
      ...a,
      photoFound: photoFound(a.photo),
      promptFound: promptFound(a.promptFile),
    })),
  };
}

function findAgent(reg, key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase();
  return reg.agents.find((a) => a.id === k || a.name.toLowerCase() === k) || null;
}

function findSeat(reg, id) {
  return reg.council.find((c) => c.id === id) || null;
}

// Owner resolves to a council seat, or to Aalia herself.
function resolveOwner(reg, ownerId) {
  if (ownerId === OWNER_ID) return { id: reg.owner.id, name: reg.owner.name, tier: 1 };
  const seat = findSeat(reg, ownerId);
  return seat ? { id: seat.id, name: seat.name, tier: 2 } : null;
}

// Agent -> owner (Tier 2, or Aalia directly) -> Aalia (Tier 1).
function escalationChain(reg, agent) {
  const chain = [];
  const owner = resolveOwner(reg, agent.owner);
  if (owner && owner.id !== OWNER_ID) chain.push(owner);
  chain.push({ id: reg.owner.id, name: reg.owner.name, tier: 1 });
  return chain;
}

module.exports = { OWNER_ID, load, withStatus, findAgent, findSeat, resolveOwner, escalationChain, photoFound, promptFound };
