export function units(value: unknown, decimals: number): bigint {
  const text = String(value);
  if (!new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${decimals}})?$`).test(text)) throw new Error(`Enter a positive amount with at most ${decimals} decimal places.`);
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  return amount;
}
export function decimal(amount: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  return `${amount / scale}.${(amount % scale).toString().padStart(decimals, '0')}`;
}
