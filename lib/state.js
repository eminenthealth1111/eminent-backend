// Persistent state for the master outbound switch and the Approval Queue.
// Stored as JSON on disk. If your host wipes disk on redeploy, mount a volume
// and point EMINENT_STATE_FILE at it.
const fs = require('fs');
const path = require('path');

const FILE = process.env.EMINENT_STATE_FILE || path.join(__dirname, '..', 'data', 'state.json');

function read() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { outboundEnabled: s.outboundEnabled !== false, queue: Array.isArray(s.queue) ? s.queue : [] };
  } catch (e) {
    return { outboundEnabled: true, queue: [] };
  }
}

function write(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { read, write, FILE };
