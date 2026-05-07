import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  PaperPlaneRight,
  Robot,
  User,
  X,
  ChatCircleDots,
  Trash,
  Spinner,
} from '@phosphor-icons/react';
import { API_BASE_URL } from '../../config/constants';

const ChatContasPagar = ({ dadosContas, resumo, filtrosAtivos, onClose }) => {
  const [mensagens, setMensagens] = useState([
    {
      role: 'assistant',
      content: `Olá! 👋 Sou seu assistente financeiro de Contas a Pagar. Tenho acesso a **${resumo?.totalContas || 0} contas** carregadas no sistema.\n\nPosso te ajudar com:\n- 📊 Análise dos dados carregados\n- 💰 Resumo de valores e vencimentos\n- 🔍 Identificar contas críticas\n- 📈 Tendências e padrões\n- ❓ Qualquer dúvida sobre as contas\n\nO que você gostaria de saber?`,
    },
  ]);
  const [inputMensagem, setInputMensagem] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [isMinimizado, setIsMinimizado] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll para última mensagem
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  // Focar no input quando abrir
  useEffect(() => {
    if (!isMinimizado) {
      inputRef.current?.focus();
    }
  }, [isMinimizado]);

  // Preparar contexto dos dados para a IA
  const prepararContexto = useCallback(() => {
    if (!dadosContas || dadosContas.length === 0) {
      return 'Nenhum dado de contas a pagar foi carregado ainda.';
    }

    const totalContas = dadosContas.length;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const fmtVal = (v) => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const fmtData = (d) => d ? new Date(d.split('T')[0]).toLocaleDateString('pt-BR') : '';

    // Calcular totalizadores
    let valorTotal = 0, valorPago = 0, valorDescontos = 0, valorJuros = 0;
    let contasPagas = 0, contasVencidas = 0, contasAVencer = 0;

    dadosContas.forEach((item) => {
      valorTotal += parseFloat(item.vl_duplicata || 0);
      valorPago += parseFloat(item.vl_pago || 0);
      valorDescontos += parseFloat(item.vl_desconto || 0);
      valorJuros += parseFloat(item.vl_juros || 0);
      if (item.dt_liq) contasPagas++;
      else if (item.dt_vencimento && new Date(item.dt_vencimento.split('T')[0]) < hoje) contasVencidas++;
      else contasAVencer++;
    });

    // Agrupar por fornecedor (apenas resumo para top 20)
    const fornecedorGrupos = {};
    dadosContas.forEach((item) => {
      const nome = (item.nm_fornecedor || 'SEM NOME');
      const chave = nome;
      if (!fornecedorGrupos[chave]) {
        fornecedorGrupos[chave] = { qtd: 0, totalValor: 0, totalPago: 0, pagas: 0, vencidas: 0 };
      }
      const g = fornecedorGrupos[chave];
      g.qtd++;
      g.totalValor += parseFloat(item.vl_duplicata || 0);
      g.totalPago += parseFloat(item.vl_pago || 0);
      if (item.dt_liq) g.pagas++;
      else if (item.dt_vencimento && new Date(item.dt_vencimento.split('T')[0]) < hoje) g.vencidas++;
    });

    // Apenas top 20 fornecedores por valor
    const top20Fornecedores = Object.entries(fornecedorGrupos)
      .sort((a, b) => b[1].totalValor - a[1].totalValor)
      .slice(0, 20)
      .map(([nome, g]) => `${nome}: ${g.qtd}ctas R$${fmtVal(g.totalValor)} Pg:R$${fmtVal(g.totalPago)} ${g.pagas}pagas ${g.vencidas}venc`)
      .join('\n');

    // Despesas agrupadas
    const despesaMap = {};
    dadosContas.forEach((item) => {
      const d = item.ds_despesaitem || 'SEM CLASSIFICAÇÃO';
      if (!despesaMap[d]) despesaMap[d] = { qtd: 0, valor: 0 };
      despesaMap[d].qtd++;
      despesaMap[d].valor += parseFloat(item.vl_duplicata || 0);
    });
    const topDespesas = Object.entries(despesaMap)
      .sort((a, b) => b[1].valor - a[1].valor)
      .slice(0, 15)
      .map(([nome, d]) => `${nome}: ${d.qtd}ctas R$${fmtVal(d.valor)}`)
      .join('\n');

    // Empresas
    const empresaMap = {};
    dadosContas.forEach((item) => {
      const emp = item.cd_empresa || 'N/A';
      if (!empresaMap[emp]) empresaMap[emp] = { qtd: 0, valor: 0 };
      empresaMap[emp].qtd++;
      empresaMap[emp].valor += parseFloat(item.vl_duplicata || 0);
    });
    const empresasStr = Object.entries(empresaMap)
      .map(([cod, d]) => `Emp${cod}: ${d.qtd}ctas R$${fmtVal(d.valor)}`)
      .join(' | ');

    // Top 10 contas vencidas
    const vencidasTop = dadosContas
      .filter((i) => !i.dt_liq && i.dt_vencimento && new Date(i.dt_vencimento.split('T')[0]) < hoje)
      .sort((a, b) => parseFloat(b.vl_duplicata || 0) - parseFloat(a.vl_duplicata || 0))
      .slice(0, 10)
      .map((i) => {
        const dias = Math.ceil((hoje - new Date(i.dt_vencimento.split('T')[0])) / 86400000);
        return `${i.nm_fornecedor} Dup:${i.nr_duplicata} R$${fmtVal(i.vl_duplicata)} ${dias}dias atraso`;
      })
      .join('\n');

    return `
CONTAS A PAGAR - ${new Date().toLocaleDateString('pt-BR')}
${filtrosAtivos ? `Filtros: ${filtrosAtivos}` : ''}
RESUMO: ${totalContas} contas | Total: R$${fmtVal(valorTotal)} | Pago: R$${fmtVal(valorPago)} | Falta: R$${fmtVal(valorTotal - valorPago)} | Descontos: R$${fmtVal(valorDescontos)} | Juros: R$${fmtVal(valorJuros)}
STATUS: ${contasPagas} pagas | ${contasVencidas} vencidas | ${contasAVencer} a vencer
EMPRESAS: ${empresasStr}
Total de fornecedores: ${Object.keys(fornecedorGrupos).length}

TOP 20 FORNECEDORES (por valor):
${top20Fornecedores}

TOP 15 DESPESAS:
${topDespesas}

TOP 10 CONTAS VENCIDAS:
${vencidasTop || 'Nenhuma'}
    `.trim();
  }, [dadosContas, filtrosAtivos]);

  // Buscar contas de um fornecedor específico baseado na pergunta do usuário
  const buscarContasRelevantes = useCallback((pergunta) => {
    if (!dadosContas || dadosContas.length === 0) return '';

    const fmtVal = (v) => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const fmtData = (d) => d ? new Date(d.split('T')[0]).toLocaleDateString('pt-BR') : '';
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const p = pergunta.toUpperCase();

    // Extrair possíveis termos de busca (palavras com 3+ chars, excluindo palavras comuns)
    const stopWords = ['QUE','QUAL','QUAIS','COMO','ONDE','QUANDO','QUANTO','CONTA','CONTAS','PAGAR','PAGO','PAGA','VALOR','TOTAL','DUPLICATA','FORNECEDOR','EMPRESA','ESTÁ','ESTA','SITUAÇÃO','SITUACAO','VENCIDA','VENCIDO','TODAS','TODOS','SOBRE','PARA','COM','UMA','UNS','DOS','DAS','DEL','NOS','NAS','POR','SER','TER','FAZ','VOCE','PODE','ACHAR','ENCONTRAR','MOSTRE','MOSTRA','LISTE','LISTAR','DETALHE','DETALHES','MEU','MEUS','MINHA','MINHAS','DELE','DELA','ESSE','ESSA','ESTE','ESTA','DESSE','DESSA','AQUELE','AQUELA','ALGUM','ALGUMA','NENHUM','NENHUMA','TODO','TODA','ENTRE','CADA','MAIS','MENOS','MUITO','MUITA','POUCO','POUCA'];

    const palavras = p.split(/\s+/)
      .filter(w => w.length >= 3 && !stopWords.includes(w));

    // Buscar fornecedores que contenham qualquer combinação das palavras
    const contasEncontradas = dadosContas.filter((item) => {
      const nome = (item.nm_fornecedor || '').toUpperCase();
      const cnpj = (item.cd_cpfcnpj || item.nr_cgc || '').replace(/\D/g, '');
      const dup = (item.nr_duplicata || '').toString();

      // Verificar se pelo menos 1 palavra bate com o fornecedor
      return palavras.some(w => nome.includes(w) || cnpj.includes(w.replace(/\D/g, '')) || dup === w);
    });

    if (contasEncontradas.length === 0 || contasEncontradas.length > 100) return '';

    // Formatar contas encontradas em detalhe
    const detalhes = contasEncontradas.map((item) => {
      const pago = item.dt_liq ? 'SIM' : 'NÃO';
      const venc = fmtData(item.dt_vencimento);
      const liq = fmtData(item.dt_liq);
      const vencida = !item.dt_liq && item.dt_vencimento && new Date(item.dt_vencimento.split('T')[0]) < hoje;
      const sitMap = { 'N': 'Normal', 'C': 'Cancelada', 'A': 'Agrupada', 'D': 'Devolvida', 'L': 'Liq.Comissão', 'Q': 'Quebrada' };
      const sit = sitMap[item.tp_situacao || item.status] || item.tp_situacao || item.status || '';

      return `- Fornecedor: ${item.nm_fornecedor} | CNPJ: ${item.cd_cpfcnpj || item.nr_cgc || ''} | Duplicata: ${item.nr_duplicata || ''} | Parcela: ${item.nr_parcela || ''} | Empresa: ${item.cd_empresa || ''} | Valor: R$${fmtVal(item.vl_duplicata)} | Pago: R$${fmtVal(item.vl_pago)} | Vencimento: ${venc} | Liquidação: ${liq} | PAGO: ${pago} | Vencida: ${vencida ? 'SIM' : 'NÃO'} | Situação: ${sit} | Despesa: ${item.ds_despesaitem || ''} | Portador: ${item.nm_portador || ''}`;
    }).join('\n');

    return `\n\nDADOS DETALHADOS ENCONTRADOS PARA A BUSCA (${contasEncontradas.length} conta(s)):\n${detalhes}`;
  }, [dadosContas]);

  // Resposta local de fallback (quando a API não está disponível)
  const gerarRespostaLocal = useCallback(
    (pergunta) => {
      if (!dadosContas || dadosContas.length === 0) {
        return '⚠️ Nenhum dado carregado. Clique em "Buscar Dados" primeiro para que eu possa analisar suas contas.';
      }

      const p = pergunta.toLowerCase();
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const totalContas = dadosContas.length;
      const valorTotal = dadosContas.reduce(
        (acc, item) => acc + parseFloat(item.vl_duplicata || 0),
        0,
      );
      const valorPago = dadosContas.reduce(
        (acc, item) => acc + parseFloat(item.vl_pago || 0),
        0,
      );

      if (p.includes('resumo') || p.includes('geral') || p.includes('total')) {
        const contasPagas = dadosContas.filter((i) => i.dt_liq).length;
        const contasVencidas = dadosContas.filter(
          (i) =>
            !i.dt_liq &&
            i.dt_vencimento &&
            new Date(i.dt_vencimento.split('T')[0]) < hoje,
        ).length;

        return (
          `📊 **Resumo Geral das Contas a Pagar**\n\n` +
          `- **Total de contas:** ${totalContas}\n` +
          `- **Valor total:** R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
          `- **Valor pago:** R$ ${valorPago.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
          `- **Falta pagar:** R$ ${(valorTotal - valorPago).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
          `- **Contas pagas:** ${contasPagas}\n` +
          `- **Contas vencidas:** ${contasVencidas}\n\n` +
          `_Para análises mais detalhadas, configure a chave da API de IA no backend (GROQ_API_KEY)._`
        );
      }

      if (p.includes('vencid') || p.includes('atras')) {
        const vencidas = dadosContas
          .filter(
            (i) =>
              !i.dt_liq &&
              i.dt_vencimento &&
              new Date(i.dt_vencimento.split('T')[0]) < hoje,
          )
          .sort(
            (a, b) =>
              parseFloat(b.vl_duplicata || 0) - parseFloat(a.vl_duplicata || 0),
          );

        const valorVencido = vencidas.reduce(
          (acc, i) => acc + parseFloat(i.vl_duplicata || 0),
          0,
        );

        let resposta = `⚠️ **Contas Vencidas:** ${vencidas.length} contas\n**Valor total vencido:** R$ ${valorVencido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n`;

        vencidas.slice(0, 5).forEach((item) => {
          const venc = new Date(item.dt_vencimento.split('T')[0]);
          const dias = Math.ceil((hoje - venc) / (1000 * 60 * 60 * 24));
          resposta += `- **${item.nm_fornecedor || 'S/N'}**: R$ ${parseFloat(item.vl_duplicata || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${dias} dias em atraso)\n`;
        });

        return resposta;
      }

      if (p.includes('fornecedor') || p.includes('maior')) {
        const fornecedorMap = {};
        dadosContas.forEach((item) => {
          const nome = item.nm_fornecedor || 'SEM NOME';
          if (!fornecedorMap[nome]) fornecedorMap[nome] = { qtd: 0, valor: 0 };
          fornecedorMap[nome].qtd++;
          fornecedorMap[nome].valor += parseFloat(item.vl_duplicata || 0);
        });

        const top = Object.entries(fornecedorMap)
          .sort((a, b) => b[1].valor - a[1].valor)
          .slice(0, 10);

        let resposta = `👥 **Top 10 Fornecedores por Valor:**\n\n`;
        top.forEach(([nome, dados], i) => {
          resposta += `${i + 1}. **${nome}**: R$ ${dados.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${dados.qtd} contas)\n`;
        });

        return resposta;
      }

      if (
        p.includes('despesa') ||
        p.includes('categor') ||
        p.includes('classific')
      ) {
        const despesaMap = {};
        dadosContas.forEach((item) => {
          const despesa = item.ds_despesaitem || 'SEM CLASSIFICAÇÃO';
          if (!despesaMap[despesa]) despesaMap[despesa] = { qtd: 0, valor: 0 };
          despesaMap[despesa].qtd++;
          despesaMap[despesa].valor += parseFloat(item.vl_duplicata || 0);
        });

        const top = Object.entries(despesaMap)
          .sort((a, b) => b[1].valor - a[1].valor)
          .slice(0, 10);

        let resposta = `📋 **Top 10 Despesas por Valor:**\n\n`;
        top.forEach(([nome, dados], i) => {
          resposta += `${i + 1}. **${nome}**: R$ ${dados.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${dados.qtd} contas)\n`;
        });

        return resposta;
      }

      if (p.includes('pag') || p.includes('liquid')) {
        const pagas = dadosContas.filter((i) => i.dt_liq);
        const valorPagoTotal = pagas.reduce(
          (acc, i) => acc + parseFloat(i.vl_pago || 0),
          0,
        );

        return (
          `✅ **Contas Pagas/Liquidadas:**\n\n` +
          `- **Quantidade:** ${pagas.length}\n` +
          `- **Valor pago:** R$ ${valorPagoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
          `- **% do total:** ${((pagas.length / totalContas) * 100).toFixed(1)}%`
        );
      }

      if (
        p.includes('semana') ||
        p.includes('próxim') ||
        p.includes('proxim') ||
        p.includes('vencer')
      ) {
        const seteDias = new Date(hoje);
        seteDias.setDate(seteDias.getDate() + 7);

        const proximasVencer = dadosContas
          .filter((i) => {
            if (i.dt_liq) return false;
            if (!i.dt_vencimento) return false;
            const venc = new Date(i.dt_vencimento.split('T')[0]);
            return venc >= hoje && venc <= seteDias;
          })
          .sort(
            (a, b) =>
              parseFloat(b.vl_duplicata || 0) - parseFloat(a.vl_duplicata || 0),
          );

        const valorProximas = proximasVencer.reduce(
          (acc, i) => acc + parseFloat(i.vl_duplicata || 0),
          0,
        );

        let resposta = `🕐 **Contas vencendo nos próximos 7 dias:** ${proximasVencer.length}\n**Valor total:** R$ ${valorProximas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n`;

        proximasVencer.slice(0, 8).forEach((item) => {
          const venc = new Date(item.dt_vencimento.split('T')[0]);
          resposta += `- **${item.nm_fornecedor || 'S/N'}**: R$ ${parseFloat(item.vl_duplicata || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${venc.toLocaleDateString('pt-BR')})\n`;
        });

        return resposta;
      }

      if (p.includes('empresa')) {
        const empresaMap = {};
        dadosContas.forEach((item) => {
          const cod = item.cd_empresa || 'N/A';
          if (!empresaMap[cod]) empresaMap[cod] = { qtd: 0, valor: 0 };
          empresaMap[cod].qtd++;
          empresaMap[cod].valor += parseFloat(item.vl_duplicata || 0);
        });

        let resposta = `🏢 **Contas por Empresa:**\n\n`;
        Object.entries(empresaMap)
          .sort((a, b) => b[1].valor - a[1].valor)
          .forEach(([cod, dados]) => {
            resposta += `- **Empresa ${cod}**: ${dados.qtd} contas, R$ ${dados.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n`;
          });

        return resposta;
      }

      return (
        `🤖 Entendi sua pergunta. Aqui está o que tenho:\n\n` +
        `- **${totalContas}** contas carregadas\n` +
        `- Valor total: **R$ ${valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}**\n\n` +
        `Tente perguntar sobre:\n` +
        `- **"resumo geral"** - visão completa\n` +
        `- **"contas vencidas"** - atrasos\n` +
        `- **"maiores fornecedores"** - quem mais cobra\n` +
        `- **"despesas por categoria"** - classificação\n` +
        `- **"vencendo essa semana"** - urgentes\n` +
        `- **"contas pagas"** - liquidadas\n` +
        `- **"por empresa"** - distribuição\n\n` +
        `_Para respostas com IA avançada, configure a GROQ_API_KEY no backend._`
      );
    },
    [dadosContas],
  );

  // Enviar mensagem para a IA
  const enviarMensagem = useCallback(
    async (mensagemOverride) => {
      const mensagem = (mensagemOverride || inputMensagem).trim();
      if (!mensagem || carregando) return;

      const novaMensagemUsuario = { role: 'user', content: mensagem };
      setMensagens((prev) => [...prev, novaMensagemUsuario]);
      setInputMensagem('');
      setCarregando(true);

      try {
        const contexto = prepararContexto();
        const dadosRelevantes = buscarContasRelevantes(mensagem);

        const historicoAPI = [
          {
            role: 'system',
            content: `Você é um assistente financeiro especializado em Contas a Pagar para a empresa Crosby (grupo de moda/confecção). Você tem acesso aos dados reais do sistema.

REGRAS:
1. Use formatação markdown: **negrito**, listas, tabelas.
2. Valores monetários sempre em R$ com 2 casas decimais.
3. A lista de TODOS OS FORNECEDORES está no contexto abaixo com: nome, CNPJ, quantidade de contas, valor total, valor pago, contas pagas e vencidas.
4. Quando houver DADOS DETALHADOS ENCONTRADOS, USE-OS para responder com precisão (fornecedor, CNPJ, duplicata, parcela, empresa, valor, pago, vencimento, liquidação, situação, despesa, portador).
5. Para saber se está PAGO: campo "PAGO: SIM" ou "Liquidação" preenchida.
6. Situação: N=Normal, C=Cancelada, A=Agrupada, D=Devolvida, L=Liq.Comissão, Q=Quebrada.
7. Se não encontrar dados detalhados, responda com base no resumo dos fornecedores.
8. Responda SEMPRE em português brasileiro.

${contexto}${dadosRelevantes}`,
          },
          ...mensagens.filter((m) => m.role !== 'system').slice(-10),
          novaMensagemUsuario,
        ];

        const response = await fetch(`${API_BASE_URL}/api/chat/contas-pagar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: historicoAPI }),
        });

        if (!response.ok) {
          throw new Error(`Erro na API: ${response.status}`);
        }

        const data = await response.json();
        const respostaIA =
          data.choices?.[0]?.message?.content ||
          data.message ||
          'Não consegui processar sua pergunta. Tente novamente.';

        setMensagens((prev) => [
          ...prev,
          { role: 'assistant', content: respostaIA },
        ]);
      } catch (error) {
        console.error('Erro ao enviar mensagem para IA:', error);

        // Fallback: resposta local quando a API não estiver disponível
        const respostaFallback = gerarRespostaLocal(mensagem);
        setMensagens((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              respostaFallback ||
              '❌ Não foi possível conectar ao assistente. Verifique sua conexão e tente novamente.',
          },
        ]);
      } finally {
        setCarregando(false);
      }
    },
    [
      inputMensagem,
      carregando,
      mensagens,
      prepararContexto,
      buscarContasRelevantes,
      gerarRespostaLocal,
    ],
  );

  // Limpar conversa
  const limparConversa = () => {
    setMensagens([
      {
        role: 'assistant',
        content: `Conversa reiniciada! 🔄 Tenho **${dadosContas?.length || 0} contas** disponíveis para análise. Como posso ajudar?`,
      },
    ]);
  };

  // Sugestões rápidas
  const sugestoes = [
    'Qual o resumo geral?',
    'Quais contas estão vencidas?',
    'Quais os maiores fornecedores?',
    'Qual o valor total a pagar?',
    'Tem contas vencendo essa semana?',
    'Despesas por categoria',
  ];

  if (isMinimizado) {
    return (
      <button
        onClick={() => setIsMinimizado(false)}
        className="fixed bottom-6 right-6 bg-[#000638] text-white p-4 rounded-full shadow-2xl hover:bg-[#fe0000] transition-all duration-300 z-50"
        title="Abrir Chat IA"
      >
        <ChatCircleDots size={28} weight="fill" />
        {mensagens.length > 1 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {mensagens.filter((m) => m.role === 'assistant').length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[420px] h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#000638] to-[#1a1f5e] text-white p-4 flex items-center justify-between rounded-t-2xl">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-2 rounded-full">
            <Robot size={22} weight="fill" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Assistente Financeiro IA</h3>
            <p className="text-xs opacity-80">
              {dadosContas?.length || 0} contas carregadas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={limparConversa}
            className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
            title="Limpar conversa"
          >
            <Trash size={16} />
          </button>
          <button
            onClick={() => setIsMinimizado(true)}
            className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
            title="Minimizar"
          >
            <span className="text-lg leading-none">−</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
            title="Fechar chat"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      </div>

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {mensagens.map((msg, index) => (
          <div
            key={index}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                msg.role === 'user' ? 'bg-[#000638]' : 'bg-emerald-500'
              }`}
            >
              {msg.role === 'user' ? (
                <User size={16} className="text-white" />
              ) : (
                <Robot size={16} className="text-white" />
              )}
            </div>

            {/* Bolha da mensagem */}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[#000638] text-white rounded-tr-sm'
                  : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-tl-sm'
              }`}
            >
              {msg.content.split('\n').map((linha, i) => {
                let processada = linha.replace(
                  /\*\*(.*?)\*\*/g,
                  '<strong>$1</strong>',
                );
                processada = processada.replace(/_(.*?)_/g, '<em>$1</em>');

                return (
                  <p
                    key={i}
                    className={`${i > 0 ? 'mt-1' : ''} ${linha === '' ? 'h-2' : ''}`}
                    dangerouslySetInnerHTML={{
                      __html: processada || '&nbsp;',
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* Indicador de digitação */}
        {carregando && (
          <div className="flex gap-2 items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
              <Robot size={16} className="text-white" />
            </div>
            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100">
              <div className="flex items-center gap-1">
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                ></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                ></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                ></div>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Sugestões rápidas */}
      {mensagens.length <= 2 && (
        <div className="px-4 py-2 border-t border-gray-100 bg-white">
          <p className="text-xs text-gray-400 mb-2">Sugestões:</p>
          <div className="flex flex-wrap gap-1">
            {sugestoes.map((sugestao, i) => (
              <button
                key={i}
                onClick={() => enviarMensagem(sugestao)}
                className="text-xs px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full hover:bg-[#000638] hover:text-white transition-colors"
              >
                {sugestao}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputMensagem}
            onChange={(e) => setInputMensagem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviarMensagem();
              }
            }}
            placeholder="Pergunte sobre suas contas..."
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#000638] focus:border-transparent bg-gray-50"
            disabled={carregando}
          />
          <button
            onClick={() => enviarMensagem()}
            disabled={!inputMensagem.trim() || carregando}
            className="bg-[#000638] text-white p-2.5 rounded-xl hover:bg-[#fe0000] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {carregando ? (
              <Spinner size={18} className="animate-spin" />
            ) : (
              <PaperPlaneRight size={18} weight="fill" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatContasPagar;
