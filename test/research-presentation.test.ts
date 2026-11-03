import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { runAutonomousMandate } from '../src/runner.js';
import { analyzeResearch, researchPublicSources, verifyResearch } from '../src/research.js';
import type { WalletOperation } from '../src/wallet-store.js';
import { nigeriaGoal, nigeriaLoader } from './fixtures/research-presentation.js';

const window: any = {};
runInNewContext(readFileSync(new URL('../public/research.js', import.meta.url), 'utf8'), { window });
const feeReceipt = window.MandateResearch.feeReceipt;
const goal = nigeriaGoal + '; research fee 0.001 NEAR';
const settled = (request: any): WalletOperation => ({
  id: request.id + '_release', userAccount: 'alice.testnet', action: 'escrow_release',
  asset: 'NEAR', amount: request.amount, recipient: request.recipient, evidenceHash: request.evidenceHash,
  status: 'confirmed', fundingTxHashes: ['funding-hash'], txHashes: ['release-hash'],
  contractId: 'escrow.testnet', mandateId: 'm_' + 'a'.repeat(40), createdAt: new Date().toISOString(),
});

describe('readable research reports and auditable research fees', () => {
  it('turns the Nigeria passages into a grouped brief while retaining plans, amounts and exact evidence', async () => {
    const research = await researchPublicSources(nigeriaGoal, nigeriaLoader);
    const analysis = analyzeResearch(research);
    expect(verifyResearch(nigeriaGoal, research, analysis).passed).toBe(true);
    expect(analysis.report).toContain('2030');
    expect(analysis.report).toContain('US$4 billion');
    expect(analysis.report).toContain('Investment intentions:');
    expect(analysis.report).toContain('letters of intent');
    expect(analysis.report).toContain('250,000');
    expect(analysis.report).toContain('Plan or target:');
    expect(analysis.report).toContain('plans to provide');
    expect(analysis.report).toContain('one million houses');
    expect(analysis.report).toContain('low-interest credit');
    expect(analysis.report).toContain('Funding and policy');
    expect(analysis.report).toContain('Jobs and skills');
    expect(analysis.report).not.toMatch(/## Answer|\[Source\]|testament to our|dedication and commitment|change the narrative|attributed passages/);
    expect(analysis.report.match(/US\$4 billion/g)).toHaveLength(1);
    expect(analysis.findings.every(finding => research.sources.find(source => source.url === finding.source)!.text.includes(finding.excerpt))).toBe(true);
  });

  it('retains distinct findings with different dates, numbers and negation', async () => {
    const research = await researchPublicSources('Research solar energy in Nigeria at https://energy-a.org/solar https://energy-b.org/solar', async url => ({
      url, contentType: 'text/html', retrievedAt: new Date().toISOString(),
      body: '<title>Solar energy in Nigeria</title><p>' + (url.includes('energy-a')
        ? 'Nigeria solar energy projects received investment of US$4 billion in 2023.'
        : 'Nigeria solar energy projects did not receive investment of US$4 billion in 2024.') + '</p>',
    }));
    const report = analyzeResearch(research).report;
    expect(report).toContain('2023');
    expect(report).toContain('did not receive');
    expect(report).toContain('2024');
  });

  it('leads a business comparison with its recommendation and keeps commercial terms below the price table', async () => {
    const request = 'Compare prices, delivery terms and warranty for 10 office chairs at https://supplier-a.org/chairs https://supplier-b.org/chairs';
    const result = await runAutonomousMandate({ goal: request, loadSource: async url => ({
      url, contentType: 'text/html', retrievedAt: new Date().toISOString(),
      body: '<title>Office chairs</title><p>Office chair orders ship within 5 business days after confirmation. Delivery is limited to domestic addresses.</p><p>Office chairs include a 2 year limited warranty covering manufacturing defects. The warranty does not cover accidental damage.</p><script type="application/ld+json">' + JSON.stringify({ '@type': 'Product', name: 'Office chair ' + (url.includes('supplier-a') ? 'A' : 'B'), offers: { '@type': 'Offer', price: url.includes('supplier-a') ? '100' : '80', priceCurrency: 'USD' } }) + '</script>',
    }) });
    const report = result.deliverable.preview;
    expect(result.deliverable.verification.passed).toBe(true);
    expect(report).toMatch(/^# Office chairs\n/);
    expect(report.indexOf('Lowest observed published price')).toBeLessThan(report.indexOf('| Source / product'));
    expect(report).toContain('800 USD for 10');
    expect(report).toContain('not negotiated quotations');
    expect(report).toContain('5 business days');
    expect(report).toContain('2 year limited warranty');
    expect(report).toContain('limited to domestic addresses');
    expect(report).toContain('does not cover accidental damage');
    expect(report).toContain('### Sources');
    expect(report.split('\n').filter(line => line.startsWith('|')).join('\n')).not.toMatch(/business days|limited warranty|\[Source\]/);
  });

  it('shows a saved 0.001 testnet NEAR release with both transaction hashes and evidence proof', async () => {
    const result = await runAutonomousMandate({ goal, loadSource: nigeriaLoader, settleEscrow: async request => settled(request) });
    expect(result.payout).toMatchObject({ status: 'confirmed', amount: '0.001 testnet NEAR', onchain: true,
      receipt: { network: 'testnet', amount: '0.001', walletOwner: 'alice.testnet', evidenceHash: result.deliverable.verification.evidenceHash,
        transactions: [{ stage: 'funding', hash: 'funding-hash', confirmed: true }, { stage: 'release', hash: 'release-hash', confirmed: true }] } });
    const restored = JSON.parse(JSON.stringify(result));
    const html = feeReceipt(restored.payout, restored.budgetState.totalBudget);
    expect(html).toContain('0.001 testnet NEAR');
    expect(html).toContain('NEAR testnet');
    expect(html).toContain('alice.testnet');
    expect(html).toContain(result.payout.recipient);
    expect(html).toContain('https://testnet.nearblocks.io/txns/funding-hash');
    expect(html).toContain('https://testnet.nearblocks.io/txns/release-hash');
    expect(html).toContain(result.deliverable.verification.evidenceHash);
    expect(html).toContain('is-confirmed');
    expect(restored.deliverable.sources.some((source: any) => source.findings.length)).toBe(true);
    expect(result.steps.at(-1)?.phase).toBe('Settlement');
  });

  it.each(['pending', 'needs_review', 'failed'] as const)('keeps funding proof when fee release is %s without claiming payment', async status => {
    const result = await runAutonomousMandate({ goal, loadSource: nigeriaLoader, settleEscrow: async request => ({ ...settled(request), status, txHashes: [], attempt: { txHash: 'signed-release-hash', signerId: 'verifier.testnet', kind: 'execution' } }) });
    expect(result.payout.status).toBe(status === 'failed' ? 'failed' : 'needs_review');
    expect(result.mandate.status).toBe('partial');
    expect(result.payout.onchain).toBe(false);
    expect(result.budgetState.spent).toBe('$0');
    const html = feeReceipt(result.payout, result.budgetState.totalBudget);
    expect(html).not.toContain('is-confirmed');
    expect(html).toContain('Escrow was funded');
    expect(html).toContain('fee release is not confirmed');
    expect(html).toContain('funding-hash');
    expect(html).toContain('signed-release-hash');
  });

  it.each(['amount', 'recipient', 'evidenceHash'] as const)('does not claim a charge from a mismatched %s receipt', async field => {
    const result = await runAutonomousMandate({ goal, loadSource: nigeriaLoader, settleEscrow: async request => ({ ...settled(request), [field]: field === 'amount' ? '0.01' : 'mismatch' }) });
    expect(result.payout.status).toBe('needs_review');
    expect(result.payout.reasons[0].code).toBe('ESCROW_RECEIPT_MISMATCH');
    expect(feeReceipt(result.payout, result.budgetState.totalBudget)).not.toContain('is-confirmed');
  });

  it('does not present confirmed escrow funding as a paid research fee', async () => {
    const result = await runAutonomousMandate({ goal, loadSource: nigeriaLoader, settleEscrow: async request => ({ ...settled(request), action: 'escrow_fund', fundingTxHashes: [], txHashes: ['funding-hash'] }) });
    expect(result.payout.status).toBe('needs_review');
    const html = feeReceipt(result.payout, result.budgetState.totalBudget);
    expect(html).toContain('Escrow funding');
    expect(html).not.toContain('is-confirmed');
    expect(html).not.toContain('Fee release · confirmed');
  });

  it('leaves unrequested and blocked fees explicit, without inventing a receipt', async () => {
    const settle = vi.fn();
    const free = await runAutonomousMandate({ goal: nigeriaGoal, loadSource: nigeriaLoader, settleEscrow: settle });
    expect(feeReceipt(free.payout, free.budgetState.totalBudget)).toContain('No research fee requested');
    const blocked = await runAutonomousMandate({ goal, loadSource: nigeriaLoader, settleEscrow: async () => { throw new Error('Wallet authorization required'); } });
    const html = feeReceipt(blocked.payout, blocked.budgetState.totalBudget);
    expect(html).toContain('Not charged');
    expect(html).toContain('No on-chain receipt');
    expect(html).not.toContain('nearblocks.io/txns/');
    expect(settle).not.toHaveBeenCalled();
  });
});
