import { spawn } from 'node:child_process';

const host = process.argv[2];
if (!host || host.startsWith('-') || !/^[a-zA-Z0-9_.@:\[\]-]+$/.test(host)) {
  console.error('Usage: node scripts/tunnel.mjs <SSH host alias or user@host>');
  process.exit(1);
}
const tunnel = spawn('ssh', [
  '-N', '-T', '-L', '127.0.0.1:8188:127.0.0.1:8188',
  '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3', host,
], { stdio: 'inherit' });
tunnel.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
tunnel.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => tunnel.kill(signal));
