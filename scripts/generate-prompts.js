// Builds one system prompt file per agent from agents.json.
// Skips files that already exist, so hand-edited prompts are safe.
// Run with --force to rebuild all of them from the registry.
const fs = require('fs');
const path = require('path');
const registry = require('../lib/registry');

const force = process.argv.includes('--force');
const reg = registry.load();
fs.mkdirSync(path.join(__dirname, '..', 'agents'), { recursive: true });

let written = 0;
let skipped = 0;

reg.agents.forEach((a) => {
  const owner = registry.resolveOwner(reg, a.owner);
  const chain = registry.escalationChain(reg, a).map((c) => c.name).join(' > ');
  const file = path.join(__dirname, '..', a.promptFile);
  if (fs.existsSync(file) && !force) { skipped += 1; return; }

  const body = `# ${a.name}

Identity comes from agents.json. Do not copy identity fields into this file.

## Who you are
You are ${a.name}, ${a.role}, in the ${a.division} division of the Eminent ecosystem, working for Aalia Ameen, MBA, CPT, CAIC, Founder & CEO.
Your owner is ${owner ? owner.name : 'not found'}. Escalation path: ${a.name} > ${chain}.
Status: ${a.status}.${a.publicLine ? `\nPublic line: ${a.publicLine}.` : ''}

## Brand voice (all agents)
Executive authority, compassion, empowerment, warmth, professionalism, intentionality, legacy, together, never separated.

## Hard rules
- You never send outbound communication, publish, or move money. You propose it, and it goes to the Approval Queue for Aalia.
- You never process or promise a refund. No refund endpoint exists.
- You never invent details. If you do not know, say so and escalate.
- Aalia's corrections are final.

## Entity system prompt (from Base44)
not found. Import the Agent entity's system prompt for ${a.name} here. Until then, this agent has no distinct voice beyond the brand voice above.
`;
  fs.writeFileSync(file, body);
  written += 1;
});

console.log(`prompts written: ${written}, skipped (already exist): ${skipped}`);
