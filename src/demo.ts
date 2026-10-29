import { runAutonomousMandate } from './runner.js';

// Read-only free research. No wallet keys, model API keys or transfers are involved.
const goal = process.argv.slice(2).join(' ') || 'Compare NEAR and USDT market prices and pool liquidity on Ref Finance';
const result = await runAutonomousMandate({ goal });
console.log(result.deliverable.preview);
console.log('\nSpecialists:', result.delegation.map(task => `${task.role}: ${task.status}`).join(', '));
console.log('Evidence verification:', result.deliverable.verification);
console.log('Paid API cost: $0. Research fee:', result.payout.amount, result.payout.status);
