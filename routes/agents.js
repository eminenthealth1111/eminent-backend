// Agent system routes. Every endpoint here requires the ADMIN_TOKEN header.
// If ADMIN_TOKEN is not set, every endpoint refuses. No refund endpoint exists.
const crypto = require('crypto');
const path = require('path');
const registry = require('../lib/registry');
const router = require('../lib/router');
const approval = require('../lib/approval');

function adminOnly(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'ADMIN_TOKEN is not configured on the server' });
  const given = String(req.get('x-admin-token') || '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = function mountAgents(app, express) {
  const root = path.join(__dirname, '..');

  // Static pages and portraits. The pages hold no data; data needs the token.
  app.use('/ui', express.static(path.join(root, 'public')));
  app.use('/assets', express.static(path.join(root, 'assets')));

  app.get('/api/agents', adminOnly, (req, res) => res.json(registry.withStatus(registry.load())));

  app.get('/api/agents/:id', adminOnly, (req, res) => {
    const reg = registry.withStatus(registry.load());
    const agent = registry.findAgent(reg, req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ ...agent, escalation: registry.escalationChain(reg, agent) });
  });

  app.post('/api/command', adminOnly, (req, res) => {
    const result = router.route(req.body);
    const { http, ...body } = result;
    res.status(http).json(body);
  });

  app.get('/api/approvals', adminOnly, (req, res) => res.json(approval.list(req.query.status)));

  app.post('/api/approvals/:id/approve', adminOnly, (req, res) => {
    try { res.json(approval.decide(req.params.id, 'approved')); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post('/api/approvals/:id/reject', adminOnly, (req, res) => {
    try { res.json(approval.decide(req.params.id, 'rejected')); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get('/api/outbound-switch', adminOnly, (req, res) => res.json({ outboundEnabled: approval.isOutboundEnabled() }));

  app.post('/api/outbound-switch', adminOnly, (req, res) => {
    if (typeof (req.body || {}).enabled !== 'boolean') return res.status(400).json({ error: 'enabled (true or false) is required' });
    res.json({ outboundEnabled: approval.setOutboundEnabled(req.body.enabled) });
  });
};
