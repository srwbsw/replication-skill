/** Machine-readable tail line for agents (see skills/replication/references/output-contract.md). */
export function printReplicationResult(payload: Record<string, unknown>): void {
  const line = `REPLICATION_RESULT: ${JSON.stringify(payload)}\n`;
  process.stdout.write(line);
}
