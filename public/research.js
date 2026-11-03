// Research receipt presentation is shared by live replies and restored conversations.
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  function feeReceipt(payout, budget) {
    if (payout.status === 'not_requested') return '<section class="research-fee-receipt"><h4>Research fee</h4><p>No research fee requested. No wallet funds were spent.</p></section>';
    const receipt = payout.receipt;
    const confirmed = payout.status === 'confirmed' && payout.onchain && !!payout.txHash
      && (!receipt || receipt.action === 'escrow_release' && receipt.status === 'confirmed'
        && receipt.transactions?.some(transaction => transaction.stage === 'release' && transaction.hash === payout.txHash && transaction.confirmed));
    const status = confirmed ? 'Confirmed' : ({ blocked: 'Not charged', pending: 'Awaiting confirmation', failed: 'Failed', needs_review: 'Needs review' }[payout.status] || 'Confirmation unavailable');
    const row = (label, value, code = false) => value ? `<div><dt>${label}</dt><dd>${code ? '<code>' : ''}${escape(value)}${code ? '</code>' : ''}</dd></div>` : '';
    const transactions = receipt?.transactions?.length ? receipt.transactions : payout.txHash ? [{ hash: payout.txHash, stage: 'release', confirmed }] : [];
    const funded = transactions.some(transaction => transaction.stage === 'funding' && transaction.confirmed);
    const transactionStatus = transaction => transaction.confirmed ? 'confirmed transaction' : transaction.status === 'failed' ? 'failed / not confirmed' : 'confirmation unavailable';
    return `<section class="research-fee-receipt${confirmed ? ' is-confirmed' : ''}" aria-label="Research fee receipt">
      <h4>Research fee receipt</h4>
      <p class="research-fee-status"><strong>${escape(payout.amount)}</strong><span>${escape(status)}</span></p>
      <p>${confirmed ? 'Released from escrow to the researcher.' : funded ? 'Escrow was funded. The research fee release is not confirmed.' : 'The research fee has not been confirmed as paid.'}</p>
      <dl class="research-fee-meta">${row('Network', 'NEAR testnet')}${row('Wallet owner', receipt?.walletOwner, true)}${row('Recipient', payout.recipient, true)}${row('Authorized budget', budget)}${receipt && !confirmed ? row('Recorded amount', receipt.amount + ' ' + receipt.asset) + row('Recorded recipient', receipt.recipient, true) : ''}${row('Escrow contract', receipt?.contractId, true)}${row('Recorded at', receipt?.recordedAt)}${row('Operation', receipt?.operationId, true)}${row('Escrow mandate', receipt?.mandateId, true)}${row('Evidence SHA-256', receipt?.evidenceHash, true)}</dl>
      ${transactions.map(transaction => `<div class="research-fee-transaction"><span>${transaction.stage === 'funding' ? 'Escrow funding' : 'Fee release'} · ${transactionStatus(transaction)}</span><a href="https://testnet.nearblocks.io/txns/${encodeURIComponent(transaction.hash)}" target="_blank" rel="noopener noreferrer">${escape(transaction.hash)} ↗</a></div>`).join('')}
      ${!transactions.length ? '<p>No on-chain receipt is available for this fee.</p>' : ''}
      ${payout.reasons?.length ? `<ul>${payout.reasons.map(reason => `<li>${escape(reason.message)}</li>`).join('')}</ul>` : ''}
      ${confirmed ? '<small>The service fee above excludes transaction gas.</small>' : ''}
    </section>`;
  }
  window.MandateResearch = { feeReceipt };
})();
