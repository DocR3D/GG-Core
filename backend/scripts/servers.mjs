// State of the CS2 servers of the LAN (`make servers`): availability, agent, RCON, last logs received.
// Reads GET /api/tournament/servers; meant to check every server before the LAN starts.

const API = process.env.API || 'http://localhost:8081';

const ago = (iso) => {
  if (!iso) return null;
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.round(s / 60)} min` : `il y a ${Math.round(s / 3600)} h`;
};

const res = await fetch(`${API}/api/tournament/servers`).catch(() => null);
if (!res?.ok) {
  console.error(`❌ Backend injoignable (${API}) : make up`);
  process.exit(1);
}
const servers = await res.json();
if (!servers.length) {
  console.log('Aucun serveur enregistré. Ajouter : make server NAME=srv-b IP=<IP du serveur CS2>');
  process.exit(0);
}

for (const s of servers) {
  const a = s.agent ?? { online: false };
  const where = `${s.ip}:${s.port}`;
  const use = s.availability === 'busy' ? `occupé (${s.busyWith?.matchId ?? '?'})` : s.availability === 'disabled' ? 'désactivé' : 'libre';
  console.log(`${s.name.padEnd(10)} ${where.padEnd(22)} ${use}`);
  if (!a.online) {
    console.log(`   ❌ agent arrêté : pas de agents.d/${s.name}.yaml, ou manager arrêté (make logs S=manager)`);
    continue;
  }
  console.log(a.rconConnected ? '   ✅ RCON connecté' : `   ❌ RCON injoignable${a.rconError ? ` : ${a.rconError}` : ''}`);
  if (a.lastLogAt) console.log(`   ✅ logs reçus ${ago(a.lastLogAt)}`);
  else console.log('   ⏳ aucun log reçu depuis le démarrage de l\'agent (logaddress_add_http collé ? serveur sur une map ?)');
  if (a.lastBadTokenAt) console.log(`   ⚠️  logs refusés ${ago(a.lastBadTokenAt)} : mauvais jeton dans logaddress_add_http (make server affiche le bon)`);
}
