# Devoluções de Mercadoria

Fluxo do cliente até o TOTVS, sem passar por planilha ou WhatsApp.

| Peça | Onde |
|---|---|
| Link público (cliente preenche) | `https://headcoach.crosbytech.com.br/devolucao` · `gestaocrosby/src/pages/DevolucaoPublica.jsx` |
| Página da equipe | `/devolucoes-mercadoria` (menu Solicitações Crosby) · `src/pages/DevolucoesMercadoria.jsx` |
| Devolução RFID embutida | `src/pages/DevolucaoRFID.jsx` (props `embutido`, `solicitacao`, `onTransacaoGerada`, `onStatusTransacao`) |
| Backend | `routes/devolucoes.routes.js` em `/api/devolucoes`, `services/devolucoesMercadoria.js`, `jobs/devolucoes-sync.job.js` |
| Banco | `migrations/devolucoes_mercadoria.sql` (tabela `devolucoes_mercadoria`) · bucket público `devolucoes-mercadoria` (criado sozinho no primeiro upload) |

## 1. O que o cliente informa no link público

1. **CPF ou CNPJ** — validado em `pes_pessoa` (cadastro sincronizado do TOTVS). Não cadastrado, não avança.
2. **Vendedor** — lista fixa em `VENDEDORES_FIXOS` (`services/devolucoesMercadoria.js`): Yago, Cleyton, Michel, David, Rafael, Arthur e Jhemyson. Não consulta o TOTVS; cada nome carrega o código do vendedor no TOTVS só para a Devolução RFID abrir já selecionada.
3. **Tipo** — `tradicional` ou `defeito` (peças com defeito).
4. **Quantidade de peças**.
5. **Foto por peça** — obrigatória pelo menos uma no defeito, opcional na tradicional. A foto é reduzida no navegador para 1280 px JPEG antes de subir. Limite de 40 fotos por solicitação.

Ao enviar, o cliente recebe o protocolo `DEV-<id>`.

## 2. Fluxo de status

```
tradicional ─► aguardando_devolucao ─► em_devolucao ─► concluida
defeito     ─► aguardando_avaliacao ─┘ (chamado da Produção concluído)
qualquer    ─► cancelada (equipe, ou chamado cancelado no Dryland)
```

- **Defeito abre um chamado no Dryland** para o setor `producao`, direção `adm`, assunto `DEVOLUÇÃO DE MERCADORIA (<cliente>)`. O texto traz cliente, vendedor, quantidade e o link de cada foto; as fotos também são anexadas ao chamado (melhor esforço).
- **Quando a Produção conclui o chamado**, a solicitação vira `aguardando_devolucao` e aparece na fila da Devolução RFID. Isso é detectado pelo job `devolucoes-sync` a cada 5 minutos e também ao abrir a página ou clicar em *Sincronizar Dryland*. O último comentário do setor no chamado fica em `avaliacao_producao`. Chamado cancelado cancela a solicitação.
- **Devolução RFID**: na linha da solicitação, o botão *RFID* abre a aba com empresa, vendedor e cliente já preenchidos. Ao gerar a transação no TOTVS, ela é vinculada à solicitação (`em_devolucao`); quando o caixa finaliza no TRAFP005 e a transação vira ATENDIDA, a solicitação fecha como `concluida`. Transação cancelada no caixa devolve a solicitação para a fila.
- A aba **Transações** lista as devoluções geradas com número, empresa, operação, etiquetas e situação no TOTVS, com botão de consulta.

Notificações no sino: `DEVOLUCAO_MERCADORIA_NOVA` ao registrar e `DEVOLUCAO_MERCADORIA_AVALIADA` quando a Produção conclui.

## 3. Endpoints

```
GET  /api/devolucoes/publico/cliente?doc=          valida CPF/CNPJ
GET  /api/devolucoes/publico/vendedores            lista fixa de vendedores
POST /api/devolucoes/publico                       { cpfCnpj, vendedorCode, tipo, qtdPecas, telefone?, observacao?, fotos:[{peca, base64}] }
GET  /api/devolucoes?status=abertas|<status>&tipo=&de=&ate=&busca=
GET  /api/devolucoes/:id          PATCH /api/devolucoes/:id  { observacao_interna?, status?, motivo? }
POST /api/devolucoes/:id/chamado           abre o chamado se ficou faltando
POST /api/devolucoes/:id/transacao         { branchCode, transactionCode, transactionDate, total, operacao, qtdEpcs, status, por }
POST /api/devolucoes/sincronizar  ·  POST /api/devolucoes/:id/sincronizar
```

O formulário público tem limite de 20 envios por IP a cada 10 minutos.

## 4. Implantação

1. Rodar `migrations/devolucoes_mercadoria.sql` no SQL Editor do Supabase (ou `node scripts/add-devolucoes-mercadoria.mjs` com `SUPABASE_DB_*` no `.env`). Enquanto não rodar, a página mostra o aviso e o formulário público responde `MIGRATION_PENDING`.
2. Reiniciar o backend (rota nova e job novo).
3. Liberar `/devolucoes-mercadoria` no Gerenciador de Acessos (categoria Solicitações Crosby).
4. Divulgar o link: em Solicitações Crosby há o bloco *Devolução de mercadoria · link público* com botão de copiar.

## 5. Decisões e limites

- O chamado é aberto pela rota interna `/api/dryland/chamados`, então herda a regra de responsável automático. Localmente a chamada vai para `http://localhost:<PORT>`; no Render usa `RENDER_EXTERNAL_URL`.
- A solicitação nunca é perdida por falha no Dryland: fica gravada com `avisoChamado`, e a página oferece *abrir chamado* para tentar de novo.
- Falha ao subir foto apaga a solicitação e devolve erro ao cliente, para ele reenviar.
- Sem `pes_pessoa` atualizado, um cliente novo do TOTVS não é reconhecido até o job `pes-pessoa-sync` rodar.
