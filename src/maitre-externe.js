// Une disponibilité lue dans SQLite peut survivre à la mort du maître. Seule une
// sonde récente du maître réel autorise les nouveaux lancements et les reprises.
class MaitreExterne {
  constructor({ url, fetcher = fetch, maintenant = Date.now, fraicheurMs = 5000 }) {
    this.url = url;
    this.fetcher = fetcher;
    this.maintenant = maintenant;
    this.fraicheurMs = fraicheurMs;
    this.invalider();
  }
  invalider() { this.luLe = null; this.machines = []; }
  get pret() { return this.luLe !== null && this.maintenant() - this.luLe < this.fraicheurMs; }
  get connexions() {
    return new Map((this.pret ? this.machines : []).filter(m => m.connectee)
      .map(m => [m.machine, { capacites: { concurrence: m.concurrence } }]));
  }
  machineDisponible(machine) { return this.pret && this.machines.some(m => m.machine === machine && m.connectee && m.etat === "online" && m.disponible); }
  async sonder() {
    try {
      const reponse = await this.fetcher(this.url, { signal: AbortSignal.timeout(2000), redirect: "error" });
      if (!reponse.ok) throw new Error(`santé maître HTTP ${reponse.status}`);
      const corps = await reponse.json();
      if (corps?.ok !== true || !Array.isArray(corps.machines) || corps.machines.some(m =>
        !m || typeof m.machine !== "string" || typeof m.connectee !== "boolean" || typeof m.disponible !== "boolean" ||
        typeof m.etat !== "string" || !Number.isInteger(m.concurrence) || m.concurrence < 1 || m.concurrence > 64)) throw new Error("santé maître incompatible");
      this.machines = corps.machines;
      this.luLe = this.maintenant();
      return true;
    } catch { this.invalider(); return false; }
  }
  async arreter() { this.invalider(); }
}

module.exports = { MaitreExterne };
