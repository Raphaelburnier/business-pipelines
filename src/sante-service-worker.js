const { parentPort, workerData } = require("node:worker_threads");
const { surveillerService, inspecterDocker } = require("./sante-plateforme");
const controle = new AbortController();

const sante = surveillerService(workerData.service, { ...workerData,
  docker: workerData.docker ? () => inspecterDocker({ signal: controle.signal }) : null,
  journal: ligne => parentPort.postMessage(ligne),
});
// Garder le thread actif même si son timer est unref ; il s'arrête avec son parent.
parentPort.on("message", message => { if (message === "arret") { controle.abort(); sante.arreter(); parentPort.close(); } });
