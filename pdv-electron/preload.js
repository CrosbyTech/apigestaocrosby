// Ponte segura entre a UI (renderer) e o Node (main process).
// A UI NUNCA toca em Node direto — só chama window.pdv.* e recebe de volta.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdv', {
  // periféricos locais (a razão de ser do desktop)
  listarImpressoras: () => ipcRenderer.invoke('perifericos:listarImpressoras'),
  imprimirCupom: (payload) => ipcRenderer.invoke('perifericos:imprimirCupom', payload),
  rfidConectar: (cfg) => ipcRenderer.invoke('perifericos:rfidConectar', cfg),
  tefConectar: (cfg) => ipcRenderer.invoke('perifericos:tefConectar', cfg),
  tefPagar: (payload) => ipcRenderer.invoke('perifericos:tefPagar', payload),

  // configuração local da máquina (cada caixa tem a sua)
  lerConfig: () => ipcRenderer.invoke('config:ler'),
  salvarConfig: (cfg) => ipcRenderer.invoke('config:salvar', cfg),

  // atualização automática (ver updater.js): estado atual, forçar verificação,
  // instalar a versão já baixada e assinar mudanças de status
  atualizacao: {
    estado: () => ipcRenderer.invoke('atualizacao:estado'),
    verificar: () => ipcRenderer.invoke('atualizacao:verificar'),
    instalar: () => ipcRenderer.invoke('atualizacao:instalar'),
    onStatus: (cb) => {
      const handler = (_e, estado) => cb(estado);
      ipcRenderer.on('atualizacao:status', handler);
      return () => ipcRenderer.removeListener('atualizacao:status', handler);
    },
  },

  plataforma: process.platform,
  versaoElectron: process.versions.electron,
});
