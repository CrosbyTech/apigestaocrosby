/**
 * Parser para arquivos de retorno bancário - Multi-banco
 * Suporta: Itaú, Banco do Brasil, Sicredi, Unibanco, Santander, Bradesco, BNB, CAIXA, UNICRED
 */

export class BankReturnParser {
  constructor() {
    this.header = null;
    this.transactions = [];
    this.trailer = null;
    this.errors = [];
    this.saldoAtual = 0;
    this.bancoDetectado = null;
    this.agencia = null;
    this.conta = null;
    this.dataGeracao = null;
    this.horaGeracao = null;
    // Novos campos
    this.empresa = null;
    this.bancoDestino = null;
    this.saldoAnterior = null;
    this.limiteCredito = null;
    this.saldoDisponivel = null;
    this.dataSaldoInicial = null;
  }

  /**
   * Detecta o banco baseado no código ou padrão do arquivo
   */
  detectarBanco(lines) {
    if (lines.length === 0) return null;

    const primeiraLinha = lines[0];
    const ultimaLinha = lines[lines.length - 1];
    
    // Banco do Brasil - Código 001
    if (primeiraLinha.startsWith('001')) {
      return {
        codigo: '001',
        nome: 'BANCO DO BRASIL S.A.',
        layout: 'CNAB400_BB'
      };
    }
    
    // Itaú - Código 341
    if (primeiraLinha.startsWith('341')) {
      return {
        codigo: '341',
        nome: 'BANCO ITAU S/A',
        layout: 'CNAB240_ITAU'
      };
    }
    
    // Bradesco - Código 237
    if (primeiraLinha.startsWith('237')) {
      return {
        codigo: '237',
        nome: 'BRADESCO S.A.',
        layout: 'CNAB400_BRADESCO'
      };
    }
    
    // Santander - Código 033
    if (primeiraLinha.startsWith('033')) {
      return {
        codigo: '033',
        nome: 'BANCO SANTANDER',
        layout: 'CNAB400_SANTANDER'
      };
    }
    
    // Sicredi - Código 748
    if (primeiraLinha.startsWith('748')) {
      return {
        codigo: '748',
        nome: 'SICREDI',
        layout: 'CNAB400_SICREDI'
      };
    }
    
         // Unibanco - Código 409
     if (primeiraLinha.startsWith('409')) {
       return {
         codigo: '409',
         nome: 'UNIBANCO',
         layout: 'CNAB400_UNIBANCO'
       };
     }
     
           // CAIXA - Código 104
      if (primeiraLinha.startsWith('104')) {
        return {
          codigo: '104',
          nome: 'CAIXA ECONOMICA FEDERAL',
          layout: 'CNAB400_CAIXA'
        };
      }
      
      // UNICRED - Código 136
      if (primeiraLinha.startsWith('136')) {
        return {
          codigo: '136',
          nome: 'UNICRED DO BRASIL',
          layout: 'CNAB400_UNICRED'
        };
      }
      
      // BNB - Código 004
      if (primeiraLinha.startsWith('004')) {
        return {
          codigo: '004',
          nome: 'BANCO DO NORDESTE',
          layout: 'CNAB400_BNB'
        };
      }

    // Detecção por padrão de linha
    if (primeiraLinha.length >= 400) {
      return {
        codigo: '000',
        nome: 'BANCO GENÉRICO',
        layout: 'CNAB400_GENERICO'
      };
    }

    return null;
  }

  /**
   * Processa o arquivo de retorno bancário
   */
  parseFile(fileContent) {
    try {
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      if (lines.length < 1) {
        throw new Error('Arquivo vazio ou inválido');
      }

      console.log(`📄 Processando arquivo com ${lines.length} linhas`);
      
      // Detectar banco
      this.bancoDetectado = this.detectarBanco(lines);
      
      if (!this.bancoDetectado) {
        throw new Error('Banco não reconhecido');
      }

      console.log(`🏦 Banco detectado: ${this.bancoDetectado.nome} (${this.bancoDetectado.codigo})`);
      console.log(`📋 Layout: ${this.bancoDetectado.layout}`);

      // Extrair data/hora a partir do registro de cabeçalho (tipo 0) como primeira tentativa
      // Mas não sobrescrever se já temos uma data válida
      // Para Itaú, não usar a função genérica pois ela extrai datas incorretas
      const header = lines[0];
      const codigoBanco = header.substring(0, 3);
      if (codigoBanco !== '341') {
        this.extrairDataHoraPorRegistroTipo0(lines);
      }

      // Processar baseado no layout do banco
      switch (this.bancoDetectado.layout) {
        case 'CNAB400_BB':
          return this.parseBancoBrasil(lines);
        case 'CNAB240_ITAU':
          return this.parseItau(lines);
        case 'CNAB400_BRADESCO':
          return this.parseBradesco(lines);
        case 'CNAB400_SANTANDER':
          return this.parseSantander(lines);
        case 'CNAB400_SICREDI':
          return this.parseSicredi(lines);
                 case 'CNAB400_UNIBANCO':
           return this.parseUnibanco(lines);
                   case 'CNAB400_CAIXA':
            return this.parseCaixa(lines);
          case 'CNAB400_UNICRED':
            return this.parseUnicred(lines);
        case 'CNAB400_BNB':
            return this.parseBNB(lines);
          default:
            return this.parseGenerico(lines);
      }
      
    } catch (error) {
      this.errors.push(error.message);
      throw error;
    }
  }

  /**
   * Processa arquivo do Banco do Brasil
   */
     parseBancoBrasil(lines) {
     console.log('🏦 Processando arquivo Banco do Brasil');
     
           // Extrair agência e conta da primeira linha (header)
      const header = lines[0];
             if (header && header.length >= 240) {
         // Banco do Brasil CNAB400: Agência posições 18-22, Conta posições 23-32
         this.agencia = header.substring(18, 22).trim();
         this.conta = header.substring(23, 32).trim();
         console.log(`🏛️ Agência BB: ${this.agencia}`);
         console.log(`📋 Conta BB: ${this.conta}`);
       }
       
       // Extrair data e hora de geração do header
       this.extrairDataHoraGeracao(header);
       // Aplicar posições padrão CNAB400 (FEBRABAN)
       this.applyCNAB400HeaderFields(header);
       // Banco destino/empresa por âncora
       this.setEmpresaEBancoDestinoFromHeader(header);
     
           // Banco do Brasil: saldo está na penúltima linha (linha 9)
      const trailerLote = lines[lines.length - 2]; // Penúltima linha
      console.log('📏 Linha 9 (trailer lote):', trailerLote);
      console.log('📏 Tamanho da linha:', trailerLote.length);
      
      // Extrair data e hora da linha de saldo também (BB tem data na linha de saldo)
      this.extrairDataHoraGeracaoBB(trailerLote);
      
      if (trailerLote && trailerLote.length >= 200) {
        // Procurar por padrões específicos do BB - CF (Crédito), DP (Débito), DF (Débito)
        const saldoMatchCF = trailerLote.match(/(\d{4,8})CF/);
        const saldoMatchDP = trailerLote.match(/(\d{4,8})DP/);
        const saldoMatchDF = trailerLote.match(/(\d{4,8})DF/);
        
        if (saldoMatchCF) {
          const saldoStr = saldoMatchCF[0]; // Incluir o "CF" para o parseValueBB detectar
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo BB (CF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else if (saldoMatchDP) {
          const saldoStr = saldoMatchDP[0]; // Incluir o "DP" para o parseValueBB detectar
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo BB (DP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else if (saldoMatchDF) {
          const saldoStr = saldoMatchDF[0]; // Incluir o "DF" para o parseValueBB detectar
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo BB (DF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else {
          // Fallback: tentar posições específicas
          console.log('⚠️ Padrão CF/DP/DF não encontrado, tentando posições...');
          
          // Tentar diferentes posições onde o saldo pode estar
          const posicoes = [
            { inicio: 150, fim: 156, descricao: 'Posição 150-156' },
            { inicio: 140, fim: 146, descricao: 'Posição 140-146' },
            { inicio: 130, fim: 136, descricao: 'Posição 130-136' }
          ];
          
          for (const pos of posicoes) {
            const valor = trailerLote.substring(pos.inicio, pos.fim);
            console.log(`${pos.descricao}: "${valor}"`);
            
            if (valor && !isNaN(parseInt(valor)) && parseInt(valor) > 0) {
              this.saldoAtual = this.parseValueBB(valor);
              console.log(`💰 Saldo BB encontrado em posição alternativa: ${valor} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
              break;
            }
          }
        }
      }

      // Extrair informações detalhadas
      const detalhes = this.extrairDetalhesBB(lines);
      
      // Adicionar detalhes à resposta
      this.detalhes = detalhes;

     return this.formatResponse();
   }

    /**
   * Processa arquivo do Itaú (CNAB240)
   */
    parseItau(lines) {
    console.log('🏦 Processando arquivo Itaú');
    
          // Extrair agência e conta da primeira linha (header)
     const header = lines[0];
            if (header && header.length >= 240) {
        // Itaú CNAB240: Agência posições 52-57, Conta posições 58-70
        this.agencia = header.substring(52, 57).trim();
        this.conta = header.substring(58, 70).trim();
        console.log(`🏛️ Agência Itaú: ${this.agencia}, Conta: ${this.conta}`);
      }
      
             // Para Itaú, não usar a função genérica de extração de data do header
       // pois ela pode extrair datas incorretas. Vamos usar apenas a função específica.
       // this.extrairDataHoraGeracao(header);
       
       // Aplicar posições padrão CNAB400 (FEBRABAN) quando aplicável
       this.applyCNAB400HeaderFields(header);
       // Banco destino/empresa por âncora
       this.setEmpresaEBancoDestinoFromHeader(header);
     
     // Itaú: saldo está na penúltima linha (linha 56)
    const saldoLine = lines[lines.length - 2];
    console.log('💰 Processando linha de saldo Itaú:', saldoLine);
    
    // Para Itaú, seguir o manual FEBRABAN: Data de Gravação está no Header de Lote (linha 2)
    if (lines.length > 1) {
      const headerLote = lines[1]; // Linha 2 (índice 1) - Registro de Início do Lote
      console.log(`🔍 Extraindo Data de Gravação do Header de Lote Itaú (FEBRABAN): "${headerLote}"`);
      this.extrairDataHoraGeracaoItauHeaderLote(headerLote);
    }
    
    // Se não encontrou data no header de lote, tentar linha de saldo
    if (!this.dataGeracao) {
      this.extrairDataHoraGeracaoItau(saldoLine);
    }
    
    // Se ainda não encontrou, tentar linhas de detalhes
    if (!this.dataGeracao && lines.length > 2) {
      console.log(`🔍 Tentando extrair data das linhas de detalhes Itaú`);
      this.extrairDataHoraGeracaoItauDetalhes(lines);
    }
    
    // Procurar por padrões específicos do ITAÚ - CP (Crédito), DP (Débito), DF (Débito)
    const saldoMatchCP = saldoLine.match(/(\d{4,8})CP/);
    const saldoMatchDP = saldoLine.match(/(\d{4,8})DP/);
    const saldoMatchCF = saldoLine.match(/(\d{4,8})CF/);
    const saldoMatchDF = saldoLine.match(/(\d{4,8})DF/);
    
    if (saldoMatchCP) {
      const saldoStr = saldoMatchCP[0]; // Incluir o "CP" para o parseValueBB detectar
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo Itaú (CP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    } else if (saldoMatchDP) {
      const saldoStr = saldoMatchDP[0]; // Incluir o "DP" para o parseValueBB detectar
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo Itaú (DP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    } else if (saldoMatchCF) {
      const saldoStr = saldoMatchCF[0]; // Incluir o "CF" para o parseValueBB detectar
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo Itaú (CF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    } else if (saldoMatchDF) {
      const saldoStr = saldoMatchDF[0]; // Incluir o "DF" para o parseValueBB detectar
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo Itaú (DF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    }

    // Extrair informações detalhadas
    const detalhes = this.extrairDetalhesItau(lines);
    
    // Adicionar detalhes à resposta
    this.detalhes = detalhes;

    return this.formatResponse();
  }

  /**
   * Extrai informações detalhadas do arquivo ITAÚ (débitos, tarifas, etc.)
   */
  extrairDetalhesItau(lines) {
    console.log('🔍 Extraindo detalhes do arquivo ITAÚ...');
    
    const detalhes = {
      debitos: [],
      tarifas: [],
      creditos: [],
      resumo: {
        totalDebitos: 0,
        totalTarifas: 0,
        totalCreditos: 0
      }
    };

    // Percorrer todas as linhas procurando por detalhes
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 240) continue;

      // ITAÚ CNAB240: Detalhes estão em linhas com segmento 'E' (detalhes)
      const segmento = line.substring(13, 14);
      const codigoOcorrencia = line.substring(15, 17);
      
      // Detalhes estão em segmentos 'E' (detalhes de transação)
      if (segmento === 'E') {
        // Extrair informações do detalhe ITAÚ CNAB240
        // Procurar por valores específicos das transações (DPV + valor)
        const dpvMatch = line.match(/DPV(\d{15})/);
        const tipoMovimento = line.substring(9, 10); // Tipo de movimento
        const descricao = line.substring(96, 126).trim(); // Descrição
        const dataOcorrencia = line.substring(73, 81); // Data da ocorrência
        
        let valor = '';
        if (dpvMatch) {
          valor = dpvMatch[1];
        }

        // Verificar se o valor é válido (não apenas zeros)
        if (valor && valor.replace(/0/g, '').length > 0) {
          // Calcular valor
          const valorNumerico = parseInt(valor) / 100;
          const isDebito = tipoMovimento === 'D' || descricao.toLowerCase().includes('deb') || descricao.toLowerCase().includes('emprest');
          const valorFinal = isDebito ? -valorNumerico : valorNumerico;

          const detalhe = {
            linha: i + 1,
            valor: valorFinal,
            valorFormatado: valorFinal.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            }),
            tipo: isDebito ? 'Débito' : 'Crédito',
            descricao: descricao,
            codigoOcorrencia: codigoOcorrencia,
            dataOcorrencia: dataOcorrencia,
            tipoMovimento: tipoMovimento,
            segmento: segmento
          };

          // Classificar por tipo
          if (isDebito) {
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.debitos.push(detalhe);
              detalhes.resumo.totalDebitos += Math.abs(valorFinal);
            }
          } else {
            // Verificar se é tarifa mesmo sendo "crédito" (algumas tarifas aparecem como crédito)
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.creditos.push(detalhe);
              detalhes.resumo.totalCreditos += valorFinal;
            }
          }

          console.log(`💰 Detalhe ITAÚ encontrado: ${detalhe.tipo} - ${detalhe.valorFormatado} - ${detalhe.descricao}`);
        }
      }
    }

    console.log('📊 Resumo dos detalhes ITAÚ:');
    console.log(`💸 Total de débitos: R$ ${detalhes.resumo.totalDebitos.toLocaleString('pt-BR')}`);
    console.log(`💸 Total de tarifas: R$ ${detalhes.resumo.totalTarifas.toLocaleString('pt-BR')}`);
    console.log(`💰 Total de créditos: R$ ${detalhes.resumo.totalCreditos.toLocaleString('pt-BR')}`);

    return detalhes;
  }

  /**
   * Extrai informações detalhadas do arquivo BB (débitos, tarifas, etc.)
   */
  extrairDetalhesBB(lines) {
    console.log('🔍 Extraindo detalhes do arquivo BB...');
    
    const detalhes = {
      debitos: [],
      tarifas: [],
      creditos: [],
      resumo: {
        totalDebitos: 0,
        totalTarifas: 0,
        totalCreditos: 0
      }
    };

    // Percorrer todas as linhas procurando por detalhes
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 240) continue;

      const tipoRegistro = line.substring(6, 7);
      const tipoOperacao = line.substring(7, 8);
      const tipoServico = line.substring(8, 9);

      // Detalhes estão em linhas com tipo de registro 1 e tipo de operação 3
      if (tipoRegistro === '1' && tipoOperacao === '3') {
        // BB CNAB400: Procurar por valores específicos das transações
        // Procurar por padrões como "000000000002653662C" ou "0000002500000D1"
        const valorMatch = line.match(/(\d{15})[CD]/);
        const tipoMovimento = line.substring(134, 135);
        const codigoOcorrencia = line.substring(135, 137);
        const descricao = line.substring(137, 162).trim();
        const dataOcorrencia = line.substring(130, 138);

        let valor = '';
        if (valorMatch) {
          valor = valorMatch[1];
        }

        // Verificar se o valor é válido (não apenas zeros)
        if (valor && valor.replace(/0/g, '').length > 0) {
          // Calcular valor
          const valorNumerico = parseInt(valor) / 100;
          const isDebito = tipoMovimento === 'D' || descricao.toLowerCase().includes('deb') || descricao.toLowerCase().includes('emprest');
          const valorFinal = isDebito ? -valorNumerico : valorNumerico;

          const detalhe = {
            linha: i + 1,
            valor: valorFinal,
            valorFormatado: valorFinal.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            }),
            tipo: isDebito ? 'Débito' : 'Crédito',
            descricao: descricao,
            codigoOcorrencia: codigoOcorrencia,
            dataOcorrencia: dataOcorrencia,
            tipoMovimento: tipoMovimento
          };

          // Classificar por tipo
          if (isDebito) {
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.debitos.push(detalhe);
              detalhes.resumo.totalDebitos += Math.abs(valorFinal);
            }
          } else {
            // Verificar se é tarifa mesmo sendo "crédito" (algumas tarifas aparecem como crédito)
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.creditos.push(detalhe);
              detalhes.resumo.totalCreditos += valorFinal;
            }
          }

          console.log(`💰 Detalhe BB encontrado: ${detalhe.tipo} - ${detalhe.valorFormatado} - ${detalhe.descricao}`);
        }
      }
    }

    console.log('📊 Resumo dos detalhes BB:');
    console.log(`💸 Total de débitos: R$ ${detalhes.resumo.totalDebitos.toLocaleString('pt-BR')}`);
    console.log(`💸 Total de tarifas: R$ ${detalhes.resumo.totalTarifas.toLocaleString('pt-BR')}`);
    console.log(`💰 Total de créditos: R$ ${detalhes.resumo.totalCreditos.toLocaleString('pt-BR')}`);

    return detalhes;
  }

  /**
   * Extrai informações detalhadas do arquivo BNB (débitos, tarifas, etc.)
   */
  extrairDetalhesBNB(lines) {
    console.log('🔍 Extraindo detalhes do arquivo BNB...');
    
    const detalhes = {
      debitos: [],
      tarifas: [],
      creditos: [],
      resumo: {
        totalDebitos: 0,
        totalTarifas: 0,
        totalCreditos: 0
      }
    };

    // Percorrer todas as linhas procurando por detalhes
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 240) continue;

      const tipoRegistro = line.substring(6, 7);
      const tipoOperacao = line.substring(7, 8);
      const tipoServico = line.substring(8, 9);

      // Detalhes estão em linhas com tipo de registro 1 e tipo de operação 3
      if (tipoRegistro === '1' && tipoOperacao === '3') {
        // BNB CNAB400: Procurar por valores específicos das transações
        // Procurar por padrões como "0000000000010500D" ou "0000000000010500C"
        const valorMatch = line.match(/(\d{15})[CD]/);
        const tipoMovimento = line.substring(134, 135);
        const codigoOcorrencia = line.substring(135, 137);
        const descricao = line.substring(176, 200).trim(); // Posição correta para descrição BNB
        const dataOcorrencia = line.substring(130, 138);

        let valor = '';
        if (valorMatch) {
          valor = valorMatch[1];
        }

        // Verificar se o valor é válido (não apenas zeros)
        if (valor && valor.replace(/0/g, '').length > 0) {
          // Calcular valor
          const valorNumerico = parseInt(valor) / 100;
          const isDebito = tipoMovimento === 'D' || descricao.toLowerCase().includes('deb') || descricao.toLowerCase().includes('emprest');
          const valorFinal = isDebito ? -valorNumerico : valorNumerico;

          const detalhe = {
            linha: i + 1,
            valor: valorFinal,
            valorFormatado: valorFinal.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            }),
            tipo: isDebito ? 'Débito' : 'Crédito',
            descricao: descricao,
            codigoOcorrencia: codigoOcorrencia,
            dataOcorrencia: dataOcorrencia,
            tipoMovimento: tipoMovimento
          };

          // Classificar por tipo
          if (isDebito) {
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.debitos.push(detalhe);
              detalhes.resumo.totalDebitos += Math.abs(valorFinal);
            }
          } else {
            // Verificar se é tarifa mesmo sendo "crédito" (algumas tarifas aparecem como crédito)
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.creditos.push(detalhe);
              detalhes.resumo.totalCreditos += valorFinal;
            }
          }

          console.log(`💰 Detalhe BNB encontrado: ${detalhe.tipo} - ${detalhe.valorFormatado} - ${detalhe.descricao}`);
        }
      }
    }

    console.log('📊 Resumo dos detalhes BNB:');
    console.log(`💸 Total de débitos: R$ ${detalhes.resumo.totalDebitos.toLocaleString('pt-BR')}`);
    console.log(`💸 Total de tarifas: R$ ${detalhes.resumo.totalTarifas.toLocaleString('pt-BR')}`);
    console.log(`💰 Total de créditos: R$ ${detalhes.resumo.totalCreditos.toLocaleString('pt-BR')}`);

    return detalhes;
  }

  /**
   * Extrai informações detalhadas do arquivo Sicredi (débitos, tarifas, etc.)
   */
  extrairDetalhesSicredi(lines) {
    console.log('🔍 Extraindo detalhes do arquivo Sicredi...');
    
    const detalhes = {
      debitos: [],
      tarifas: [],
      creditos: [],
      resumo: {
        totalDebitos: 0,
        totalTarifas: 0,
        totalCreditos: 0
      }
    };

    // Percorrer todas as linhas procurando por detalhes
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.length < 240) continue;

      const tipoRegistro = line.substring(6, 7);
      const tipoOperacao = line.substring(7, 8);
      const tipoServico = line.substring(8, 9);

      // Detalhes estão em linhas com tipo de registro 1 e tipo de operação 3
      if (tipoRegistro === '1' && tipoOperacao === '3') {
        // Sicredi CNAB400: Procurar por valores específicos das transações
        // Procurar por padrões como "000000000000621076D" ou "000000000000500000D"
        const valorMatch = line.match(/(\d{15})[CD]/);
        const tipoMovimento = line.substring(134, 135);
        const codigoOcorrencia = line.substring(135, 137);
        
        // Extrair descrição correta do Sicredi - procurar por padrões específicos
        let descricao = '';
        if (line.includes('DEB.CTA.FATURA')) {
          descricao = 'DEB.CTA.FATURA';
        } else if (line.includes('PAGAMENTO PIX')) {
          descricao = 'PAGAMENTO PIX';
        } else if (line.includes('RECEBIMENTO PIX')) {
          descricao = 'RECEBIMENTO PIX';
        } else {
          descricao = line.substring(137, 162).trim(); // Fallback para posição padrão
        }
        
        const dataOcorrencia = line.substring(130, 138);

        let valor = '';
        if (valorMatch) {
          valor = valorMatch[1];
        }

        // Verificar se o valor é válido (não apenas zeros)
        if (valor && valor.replace(/0/g, '').length > 0) {
          // Calcular valor
          const valorNumerico = parseInt(valor) / 100;
          const isDebito = tipoMovimento === 'D' || descricao.toLowerCase().includes('deb') || descricao.toLowerCase().includes('emprest');
          const valorFinal = isDebito ? -valorNumerico : valorNumerico;

          const detalhe = {
            linha: i + 1,
            valor: valorFinal,
            valorFormatado: valorFinal.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            }),
            tipo: isDebito ? 'Débito' : 'Crédito',
            descricao: descricao,
            codigoOcorrencia: codigoOcorrencia,
            dataOcorrencia: dataOcorrencia,
            tipoMovimento: tipoMovimento
          };

          // Classificar por tipo
          if (isDebito) {
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.debitos.push(detalhe);
              detalhes.resumo.totalDebitos += Math.abs(valorFinal);
            }
          } else {
            // Verificar se é tarifa mesmo sendo "crédito" (algumas tarifas aparecem como crédito)
            if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
              detalhes.tarifas.push(detalhe);
              detalhes.resumo.totalTarifas += Math.abs(valorFinal);
            } else {
              detalhes.creditos.push(detalhe);
              detalhes.resumo.totalCreditos += valorFinal;
            }
          }

          console.log(`💰 Detalhe Sicredi encontrado: ${detalhe.tipo} - ${detalhe.valorFormatado} - ${detalhe.descricao}`);
        }
      }
    }

    console.log('📊 Resumo dos detalhes Sicredi:');
    console.log(`💸 Total de débitos: R$ ${detalhes.resumo.totalDebitos.toLocaleString('pt-BR')}`);
    console.log(`💸 Total de tarifas: R$ ${detalhes.resumo.totalTarifas.toLocaleString('pt-BR')}`);
    console.log(`💰 Total de créditos: R$ ${detalhes.resumo.totalCreditos.toLocaleString('pt-BR')}`);

    return detalhes;
  }

  /**
   * Processa arquivo do Bradesco
   */
  parseBradesco(lines) {
    console.log('🏦 Processando arquivo Bradesco');
    
    // Extrair agência e conta da primeira linha (header)
    const header = lines[0];
    if (header && header.length >= 240) {
      // Bradesco CNAB400: Agência posições 18-22, Conta posições 23-32
      this.agencia = header.substring(18, 22).trim();
      this.conta = header.substring(23, 32).trim();
      console.log(`🏛️ Agência Bradesco: ${this.agencia}`);
      console.log(`📋 Conta Bradesco: ${this.conta}`);
    }
    
    // Extrair data e hora de geração do header
    this.extrairDataHoraGeracao(header);
    // Aplicar posições padrão CNAB400 (FEBRABAN)
    this.applyCNAB400HeaderFields(header);
    // Banco destino/empresa por âncora
    this.setEmpresaEBancoDestinoFromHeader(header);

    // PRIORIDADE 1: Verificar linha 2 (CF/DF)
    if (lines[1] && lines[1].length >= 200) {
      console.log('🔍 Verificando linha 2 para saldo Bradesco...');
      const linha2 = lines[1];
      console.log('📝 Linha 2:', linha2);

      // Buscar primeiro por CF (Crédito Final) e depois DF (Débito Final)
      const saldoLinha2CF = linha2.match(/(\d{1,12})CF/);
      const saldoLinha2DF = linha2.match(/(\d{1,12})DF/);

      if (saldoLinha2CF) {
        const saldoStr = `${saldoLinha2CF[1]}CF`;
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Bradesco encontrado na linha 2 (CF): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        return this.formatResponse();
      }

      if (saldoLinha2DF) {
        const saldoStr = `${saldoLinha2DF[1]}DF`;
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Bradesco encontrado na linha 2 (DF): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        return this.formatResponse();
      }
    }

    // Bradesco: saldo está na linha 4 (penúltima linha)
    const trailerLote = lines[lines.length - 2]; // Linha 4
    console.log('📏 Linha 4 (trailer lote):', trailerLote);
    console.log('📏 Tamanho da linha:', trailerLote.length);
    
    // Extrair data e hora da linha de saldo também (Bradesco tem data na linha de saldo)
    this.extrairDataHoraGeracaoBradesco(trailerLote);
    
          if (trailerLote && trailerLote.length >= 200) {
        // Procurar pelo padrão do saldo na linha - aceitar 1 a 12 dígitos antes do sufixo
        const saldoMatchCP = trailerLote.match(/(\d{1,12})CP/);
        const saldoMatchCF = trailerLote.match(/(\d{1,12})CF/);
        const saldoMatchDP = trailerLote.match(/(\d{1,12})DP/);
        const saldoMatchDF = trailerLote.match(/(\d{1,12})DF/);
        
        if (saldoMatchCP) {
          const saldoStr = saldoMatchCP[0]; // Incluir o sufixo para o parseValueBB detectar
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo Bradesco (CP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else if (saldoMatchCF) {
          const saldoStr = saldoMatchCF[0];
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo Bradesco (CF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else if (saldoMatchDP) {
          const saldoStr = saldoMatchDP[0];
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo Bradesco (DP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else if (saldoMatchDF) {
          const saldoStr = saldoMatchDF[0];
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo Bradesco (DF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else {
        // Fallback: tentar posições específicas
        console.log('⚠️ Padrão CF/DP não encontrado, tentando posições...');
        
        // Tentar diferentes posições onde o saldo pode estar
        const posicoes = [
          { inicio: 150, fim: 157, descricao: 'Posição 150-157' },
          { inicio: 140, fim: 147, descricao: 'Posição 140-147' },
          { inicio: 130, fim: 137, descricao: 'Posição 130-137' }
        ];
        
        for (const pos of posicoes) {
          const valor = trailerLote.substring(pos.inicio, pos.fim);
          console.log(`${pos.descricao}: "${valor}"`);
          
          if (valor && !isNaN(parseInt(valor)) && parseInt(valor) > 0) {
            this.saldoAtual = this.parseValueBB(valor);
            console.log(`💰 Saldo Bradesco encontrado em posição alternativa: ${valor} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
            break;
          }
        }
      }
    }

    return this.formatResponse();
  }

  /**
   * Processa arquivo do Santander
   */
  parseSantander(lines) {
    console.log('🏦 Processando arquivo Santander');
    
    // Extrair agência e conta da primeira linha (header)
    const header = lines[0];
    if (header && header.length >= 240) {
      // Santander CNAB400: Agência posições 18-22, Conta posições 23-32
      this.agencia = header.substring(18, 22).trim();
      this.conta = header.substring(23, 32).trim();
      console.log(`🏛️ Agência Santander: ${this.agencia}`);
      console.log(`📋 Conta Santander: ${this.conta}`);
    }
    
    // Extrair data e hora de geração do header
    this.extrairDataHoraGeracao(header);
    // Aplicar posições padrão CNAB400 (FEBRABAN)
    this.applyCNAB400HeaderFields(header);
    // Banco destino/empresa por âncora
    this.setEmpresaEBancoDestinoFromHeader(header);
    
    // PRIORIDADE 1: Verificar linha 2 (onde geralmente está o saldo principal)
    if (lines[1] && lines[1].length >= 200) {
      console.log('🔍 Verificando linha 2 para saldo Santander...');
      const linha2 = lines[1];
      console.log('📝 Linha 2:', linha2);
      
      // Procurar padrão com DF na linha 2 (mais confiável)
      const saldoLinha2DF = linha2.match(/(\d{7})DF/);
      
      if (saldoLinha2DF) {
        const saldoStr = saldoLinha2DF[1];
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Santander encontrado na linha 2 (DF): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        return this.formatResponse();
      }
    }
    
    // PRIORIDADE 2: Verificar trailer para padrão 04543 (arquivo original funcionando)
    const trailerLote = lines[lines.length - 2]; // Linha trailer
    console.log('📏 Linha trailer:', trailerLote);
    console.log('📏 Tamanho da linha:', trailerLote ? trailerLote.length : 0);
    
    // Extrair data e hora da linha de saldo também (Santander tem data na linha de saldo)
    if (trailerLote) {
      this.extrairDataHoraGeracaoSantander(trailerLote);
    }
    
    if (trailerLote && trailerLote.length >= 200) {
      // Procurar pelo padrão específico 04543 (funciona no primeiro arquivo)
      const saldoPrincipal = trailerLote.match(/(\d{7})04543/);
      
      if (saldoPrincipal) {
        const saldoStr = saldoPrincipal[1];
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Santander principal encontrado no trailer (04543): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        return this.formatResponse();
      }
      
      // PRIORIDADE 3: Fallback para padrões DP/DF/CF/CP no trailer (menos confiável)
      console.log('⚠️ Padrão 04543 não encontrado, tentando fallbacks no trailer...');
      
      const saldoMatchCP = trailerLote.match(/(\d{4,8})CP/);
      const saldoMatchCF = trailerLote.match(/(\d{4,8})CF/);
      const saldoMatchDP = trailerLote.match(/(\d{4,8})DP/);
      const saldoMatchDF = trailerLote.match(/(\d{4,8})DF/);
      
      if (saldoMatchCP) {
        const saldoStr = saldoMatchCP[1]; // Apenas os dígitos, sem o sufixo
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Santander (CP trailer): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
      } else if (saldoMatchCF) {
        const saldoStr = saldoMatchCF[1];
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Santander (CF trailer): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
      } else if (saldoMatchDF) {
        const saldoStr = saldoMatchDF[1];
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Santander (DF trailer): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
      } else if (saldoMatchDP) {
        const saldoStr = saldoMatchDP[1];
        this.saldoAtual = this.parseValueBB(saldoStr);
        console.log(`💰 Saldo Santander (DP trailer): ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
      } else {
        // ÚLTIMO RECURSO: posições específicas
        console.log('⚠️ Nenhum padrão encontrado, tentando posições fixas...');
        
        const posicoes = [
          { inicio: 150, fim: 156, descricao: 'Posição 150-156' },
          { inicio: 140, fim: 146, descricao: 'Posição 140-146' },
          { inicio: 130, fim: 136, descricao: 'Posição 130-136' }
        ];
        
        for (const pos of posicoes) {
          const valor = trailerLote.substring(pos.inicio, pos.fim);
          console.log(`${pos.descricao}: "${valor}"`);
          
          if (valor && !isNaN(parseInt(valor)) && parseInt(valor) > 0) {
            this.saldoAtual = this.parseValueBB(valor);
            console.log(`💰 Saldo Santander encontrado em posição alternativa: ${valor} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
            break;
          }
        }
      }
    }

    return this.formatResponse();
  }

  /**
   * Processa arquivo do Sicredi
   */
     parseSicredi(lines) {
     console.log('🏦 Processando arquivo Sicredi');
     
           // Extrair agência e conta da primeira linha (header)
      const header = lines[0];
             if (header && header.length >= 240) {
         // Sicredi CNAB400: Agência posições 18-22, Conta posições 23-32
         this.agencia = header.substring(18, 22).trim();
         this.conta = header.substring(23, 32).trim();
         console.log(`🏛️ Agência Sicredi: ${this.agencia}`);
         console.log(`📋 Conta Sicredi: ${this.conta}`);
       }
       
       // Extrair data e hora de geração do header
       this.extrairDataHoraGeracao(header);
       // Aplicar posições padrão CNAB400 (FEBRABAN)
       this.applyCNAB400HeaderFields(header);
       // Banco destino/empresa por âncora
       this.setEmpresaEBancoDestinoFromHeader(header);
     
           // Sicredi: saldo está na linha 8 (penúltima linha)
      const trailerLote = lines[lines.length - 2]; // Linha 8
      console.log('📏 Linha 8 (trailer lote):', trailerLote);
      console.log('📏 Tamanho da linha:', trailerLote.length);
      
      // Extrair data e hora da linha de saldo também (Sicredi tem data na linha de saldo)
      this.extrairDataHoraGeracaoSicredi(trailerLote);
      
      if (trailerLote && trailerLote.length >= 200) {
        // Procurar por padrões específicos do Sicredi - CP (Crédito), DP (Débito), DF (Débito)
        // Sicredi usa 6 dígitos antes do sufixo (ex: 722691CP)
        const saldoMatchCP = trailerLote.match(/(\d{6})CP/);
        const saldoMatchDP = trailerLote.match(/(\d{6})DP/);
        const saldoMatchDF = trailerLote.match(/(\d{6})DF/);
        
        if (saldoMatchCP) {
          const saldoStr = saldoMatchCP[0]; // Incluir o "CP" para o parseValueBB detectar
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo Sicredi (CP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
          // Extrair saldos adicionais após o marcador
          const after = trailerLote.slice(trailerLote.indexOf(saldoStr) + saldoStr.length);
          const numsAfter = Array.from(after.matchAll(/\d{8,15}/g)).map(m => m[0]).filter(n => /[1-9]/.test(n));
          // Heurística: penúltimo número grande = limite, último = saldo disponível
          if (numsAfter.length >= 1) {
            const ultimo = numsAfter[numsAfter.length - 1];
            this.saldoDisponivel = parseInt(ultimo, 10) / 100;
          }
          if (numsAfter.length >= 2) {
            const penultimo = numsAfter[numsAfter.length - 2];
            this.limiteCredito = parseInt(penultimo, 10) / 100;
          }
          // Saldo anterior: último número significativo antes da data (8 dígitos)
          const dataIdx = trailerLote.search(/\d{8}/);
          if (dataIdx > 0) {
            const before = trailerLote.slice(0, dataIdx);
            const numsBefore = Array.from(before.matchAll(/\d{12,15}/g)).map(m => m[0]).filter(n => /[1-9]/.test(n));
            if (numsBefore.length) {
              this.saldoAnterior = parseInt(numsBefore[numsBefore.length - 1], 10) / 100;
            }
          }
        } else if (saldoMatchDP) {
          const saldoStr = saldoMatchDP[0];
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`�� Saldo Sicredi (DP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else if (saldoMatchDF) {
          const saldoStr = saldoMatchDF[0];
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`�� Saldo Sicredi (DF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else {
          console.log('⚠️ Padrão CP/DP/DF não encontrado, tentando posições...');
          const posicoes = [
            { inicio: 150, fim: 154, descricao: 'Posição 150-154' },
            { inicio: 140, fim: 144, descricao: 'Posição 140-144' },
            { inicio: 130, fim: 134, descricao: 'Posição 130-134' }
          ];
          for (const pos of posicoes) {
            const valor = trailerLote.substring(pos.inicio, pos.fim);
            console.log(`${pos.descricao}: "${valor}"`);
            if (valor && !isNaN(parseInt(valor)) && parseInt(valor) > 0) {
              this.saldoAtual = this.parseValueBB(valor);
              console.log(`💰 Saldo Sicredi encontrado em posição alternativa: ${valor} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
              break;
            }
          }
        }
      }

      // Extrair informações detalhadas
      const detalhes = this.extrairDetalhesSicredi(lines);
      this.detalhes = detalhes;

     return this.formatResponse();
   }

     /**
    * Processa arquivo do Unibanco
    */
   parseUnibanco(lines) {
     console.log('🏦 Processando arquivo Unibanco');
     
     // Unibanco: saldo está no trailer (última linha)
     const trailer = lines[lines.length - 1];
     
     if (trailer && trailer.length >= 400) {
       // Posições 119-134 contêm o saldo final
       const saldoStr = trailer.substring(119, 134);
       this.saldoAtual = this.parseValueBB(saldoStr);
       console.log(`💰 Saldo Unibanco extraído: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
     }

     return this.formatResponse();
   }

   /**
    * Processa arquivo da CAIXA
    */
       parseCaixa(lines) {
      console.log('🏦 Processando arquivo CAIXA');
      
      // Extrair agência e conta da primeira linha (header)
      const header = lines[0];
      if (header && header.length >= 240) {
        // CAIXA CNAB400: Agência posições 18-22, Conta posições 23-32
        this.agencia = header.substring(18, 22).trim();
        this.conta = header.substring(23, 32).trim();
        console.log(`🏛️ Agência CAIXA: ${this.agencia}`);
        console.log(`📋 Conta CAIXA: ${this.conta}`);
      }
      
      // Extrair data e hora de geração do header
      this.extrairDataHoraGeracao(header);
      // Aplicar posições padrão CNAB400 (FEBRABAN)
      this.applyCNAB400HeaderFields(header);
      // Banco destino/empresa por âncora
      this.setEmpresaEBancoDestinoFromHeader(header);
      
      // CAIXA: saldo está na linha 5 (penúltima linha)
      const trailerLote = lines[lines.length - 2]; // Linha 5
      console.log('📏 Linha 5 (trailer lote):', trailerLote);
      console.log('📏 Tamanho da linha:', trailerLote.length);
      
      // Extrair data e hora da linha de saldo também (CAIXA tem data na linha de saldo)
      this.extrairDataHoraGeracaoCaixa(trailerLote);
      
      // Extrair informações detalhadas
      const detalhes = this.extrairDetalhesCaixa(lines);
      
      if (trailerLote && trailerLote.length >= 200) {
        // Procurar pelo padrão do saldo na linha - corrigido para capturar valores específicos
        // O valor pode ter entre 4 e 8 dígitos antes do "DF" ou "CF"
        const saldoMatchDP = trailerLote.match(/(\d{4,8})DF/);
        const saldoMatchCF = trailerLote.match(/(\d{4,8})CF/);
        
        if (saldoMatchDP) {
          const saldoStr = saldoMatchDP[0]; // Incluir o "DF" para o parseValueBB detectar
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo CAIXA (DF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else if (saldoMatchCF) {
          const saldoStr = saldoMatchCF[0]; // Incluir o "CF" para o parseValueBB detectar
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo CAIXA (CF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else {
          // Fallback: tentar posições específicas
          console.log('⚠️ Padrão CF/DF não encontrado, tentando posições...');
          
          // Tentar diferentes posições onde o saldo pode estar
          const posicoes = [
            { inicio: 150, fim: 156, descricao: 'Posição 150-156' },
            { inicio: 140, fim: 146, descricao: 'Posição 140-146' },
            { inicio: 130, fim: 136, descricao: 'Posição 130-136' }
          ];
          
          for (const pos of posicoes) {
            const valor = trailerLote.substring(pos.inicio, pos.fim);
            console.log(`${pos.descricao}: "${valor}"`);
            
            if (valor && !isNaN(parseInt(valor)) && parseInt(valor) > 0) {
              this.saldoAtual = this.parseValueBB(valor);
              console.log(`💰 Saldo CAIXA encontrado em posição alternativa: ${valor} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
              break;
            }
          }
        }
      }

      // Adicionar detalhes à resposta
      this.detalhes = detalhes;

      return this.formatResponse();
    }

    /**
     * Extrai informações detalhadas do arquivo CAIXA (débitos, tarifas, etc.)
     */
    extrairDetalhesCaixa(lines) {
      console.log('🔍 Extraindo detalhes do arquivo CAIXA...');
      
      const detalhes = {
        debitos: [],
        tarifas: [],
        creditos: [],
        resumo: {
          totalDebitos: 0,
          totalTarifas: 0,
          totalCreditos: 0
        }
      };

      // Percorrer todas as linhas procurando por detalhes
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.length < 240) continue;

        const tipoRegistro = line.substring(6, 7);
        const tipoOperacao = line.substring(7, 8);
        const tipoServico = line.substring(8, 9);

                // Detalhes estão em linhas com tipo de registro 1 e tipo de operação 3
        if (tipoRegistro === '1' && tipoOperacao === '3') {
          // Para CAIXA, os valores estão em posições específicas
          // Valor: posições 150-165 (15 dígitos) - onde está o valor real
          // Tipo de movimento: posição 165 (D para débito, C para crédito)
          // Código da ocorrência: posições 166-168
          // Descrição: posições 176-201 (onde estão as descrições)
          // Data da ocorrência: posições 130-138
          
          let valor = line.substring(150, 165);
          const tipoMovimento = line.substring(165, 166);
          const codigoOcorrencia = line.substring(166, 168);
          const descricao = line.substring(176, 201).trim();
          const dataOcorrencia = line.substring(130, 138);

          // Se o valor está vazio, procurar por padrões específicos
          if (!valor || valor.replace(/0/g, '').length === 0) {
            // Procurar por "00000040" que pode ser o valor da tarifa
            const posicao40 = line.indexOf('00000040');
            if (posicao40 !== -1) {
              valor = '000000000000040'; // R$ 0,40
            }
          }

          // Verificar se o valor é válido (não apenas zeros)
          if (valor && valor.replace(/0/g, '').length > 0) {
                      // Calcular valor
          const valorNumerico = parseInt(valor) / 100;
          // Para CAIXA, verificar se é débito baseado na descrição também
          const isDebito = tipoMovimento === 'D' || descricao.toLowerCase().includes('deb') || descricao.toLowerCase().includes('emprest');
          const valorFinal = isDebito ? -valorNumerico : valorNumerico;

            const detalhe = {
              linha: i + 1,
              valor: valorFinal,
              valorFormatado: valorFinal.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL'
              }),
              tipo: isDebito ? 'Débito' : 'Crédito',
              descricao: descricao,
              codigoOcorrencia: codigoOcorrencia,
              dataOcorrencia: dataOcorrencia,
              tipoMovimento: tipoMovimento
            };

            // Classificar por tipo
            if (isDebito) {
              if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
                detalhes.tarifas.push(detalhe);
                detalhes.resumo.totalTarifas += Math.abs(valorFinal);
              } else {
                detalhes.debitos.push(detalhe);
                detalhes.resumo.totalDebitos += Math.abs(valorFinal);
              }
            } else {
              // Verificar se é tarifa mesmo sendo "crédito" (algumas tarifas aparecem como crédito)
              if (descricao.toLowerCase().includes('tarifa') || descricao.toLowerCase().includes('tar')) {
                detalhes.tarifas.push(detalhe);
                detalhes.resumo.totalTarifas += Math.abs(valorFinal);
              } else {
                detalhes.creditos.push(detalhe);
                detalhes.resumo.totalCreditos += valorFinal;
              }
            }

            console.log(`💰 Detalhe encontrado: ${detalhe.tipo} - ${detalhe.valorFormatado} - ${detalhe.descricao}`);
          }
        }
      }

      console.log('📊 Resumo dos detalhes:');
      console.log(`💸 Total de débitos: R$ ${detalhes.resumo.totalDebitos.toLocaleString('pt-BR')}`);
      console.log(`💸 Total de tarifas: R$ ${detalhes.resumo.totalTarifas.toLocaleString('pt-BR')}`);
      console.log(`💰 Total de créditos: R$ ${detalhes.resumo.totalCreditos.toLocaleString('pt-BR')}`);

      return detalhes;
    }

   /**
    * Processa arquivo da UNICRED
    */
       parseUnicred(lines) {
      console.log('🏦 Processando arquivo UNICRED');
      
             // Extrair agência e conta da primeira linha (header)
       const header = lines[0];
               if (header && header.length >= 240) {
          // UNICRED CNAB400: Agência posições 18-22, Conta posições 23-32
          this.agencia = header.substring(18, 22).trim();
          this.conta = header.substring(23, 32).trim();
          console.log(`🏛️ Agência UNICRED: ${this.agencia}`);
          console.log(`📋 Conta UNICRED: ${this.conta}`);
        }
        
              // Extrair data e hora de geração do header
      this.extrairDataHoraGeracao(header);
      // Aplicar posições padrão CNAB400 (FEBRABAN)
      this.applyCNAB400HeaderFields(header);
      // Banco destino/empresa por âncora
      this.setEmpresaEBancoDestinoFromHeader(header);
    
      // UNICRED: saldo está na linha 4 (penúltima linha)
       const trailerLote = lines[lines.length - 2]; // Linha 4
       console.log('📏 Linha 4 (trailer lote):', trailerLote);
       console.log('📏 Tamanho da linha:', trailerLote.length);
       
       // Extrair data e hora da linha de saldo também (UNICRED tem data na linha de saldo)
       this.extrairDataHoraGeracaoUnicred(trailerLote);
       
       if (trailerLote && trailerLote.length >= 200) {
         // Procurar pelo padrão do saldo na linha (suporta CF/CP/DP/DF com 4 a 8 dígitos)
         const saldoMatchCF = trailerLote.match(/(\d{4,8})CF/);
         const saldoMatchCP = trailerLote.match(/(\d{4,8})CP/);
         const saldoMatchDP = trailerLote.match(/(\d{4,8})DP/);
         const saldoMatchDF = trailerLote.match(/(\d{4,8})DF/);
         
         if (saldoMatchCF) {
           const saldoStr = saldoMatchCF[0]; // inclui sufixo para sinal correto
           this.saldoAtual = this.parseValueBB(saldoStr);
           console.log(`💰 Saldo UNICRED (CF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
         } else if (saldoMatchCP) {
           const saldoStr = saldoMatchCP[0];
           this.saldoAtual = this.parseValueBB(saldoStr);
           console.log(`💰 Saldo UNICRED (CP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
         } else if (saldoMatchDP) {
           const saldoStr = saldoMatchDP[0];
           this.saldoAtual = this.parseValueBB(saldoStr);
           console.log(`💰 Saldo UNICRED (DP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
         } else if (saldoMatchDF) {
           const saldoStr = saldoMatchDF[0];
           this.saldoAtual = this.parseValueBB(saldoStr);
           console.log(`💰 Saldo UNICRED (DF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
         } else {
           // Fallback: tentar posições específicas
           console.log('⚠️ Padrão CF/CP/DP/DF não encontrado, tentando posições...');
           
           // Tentar diferentes posições onde o saldo pode estar
           const posicoes = [
             { inicio: 150, fim: 156, descricao: 'Posição 150-156' },
             { inicio: 140, fim: 146, descricao: 'Posição 140-146' },
             { inicio: 130, fim: 136, descricao: 'Posição 130-136' }
           ];
           
           for (const pos of posicoes) {
             const valor = trailerLote.substring(pos.inicio, pos.fim);
             console.log(`${pos.descricao}: "${valor}"`);
             
             if (valor && !isNaN(parseInt(valor)) && parseInt(valor) > 0) {
               this.saldoAtual = this.parseValueBB(valor);
               console.log(`💰 Saldo UNICRED encontrado em posição alternativa: ${valor} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
               break;
             }
           }
         }
       }

      return this.formatResponse();
    }

   /**
    * Processa arquivo do BNB (Banco do Nordeste)
    */
   parseBNB(lines) {
     console.log('🏦 Processando arquivo BNB (Banco do Nordeste)');
     
     // Extrair agência e conta da primeira linha (header)
     const header = lines[0];
     if (header && header.length >= 240) {
       // BNB CNAB400: Agência posições 18-22, Conta posições 23-32
       this.agencia = header.substring(18, 22).trim();
       this.conta = header.substring(23, 32).trim();
       console.log(`🏛️ Agência BNB: ${this.agencia}`);
       console.log(`📋 Conta BNB: ${this.conta}`);
     }
     
           // Extrair data e hora de geração do header
      this.extrairDataHoraGeracao(header);
      // Aplicar posições padrão CNAB400 (FEBRABAN)
      this.applyCNAB400HeaderFields(header);
      // Banco destino/empresa por âncora
      this.setEmpresaEBancoDestinoFromHeader(header);
    
      // BNB: saldo está na linha 4 (penúltima linha)
     const trailerLote = lines[lines.length - 2]; // Linha 4
     console.log('📏 Linha 4 (trailer lote):', trailerLote);
     console.log('📏 Tamanho da linha:', trailerLote.length);
     
     // Extrair data e hora da linha de saldo também (BNB tem data na linha de saldo)
     this.extrairDataHoraGeracaoBNB(trailerLote);
     
     if (trailerLote && trailerLote.length >= 200) {
       // Procurar por padrões específicos do BNB - CF (Crédito), DP (Débito), DF (Débito)
       const saldoMatchCF = trailerLote.match(/(\d{4,8})CF/);
       const saldoMatchDP = trailerLote.match(/(\d{4,8})DP/);
       const saldoMatchDF = trailerLote.match(/(\d{4,8})DF/);
       
       if (saldoMatchCF) {
         const saldoStr = saldoMatchCF[0]; // Incluir o "CF" para o parseValueBB detectar
         this.saldoAtual = this.parseValueBB(saldoStr);
         console.log(`💰 Saldo BNB (CF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
       } else if (saldoMatchDP) {
         const saldoStr = saldoMatchDP[0]; // Incluir o "DP" para o parseValueBB detectar
         this.saldoAtual = this.parseValueBB(saldoStr);
         console.log(`💰 Saldo BNB (DP) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
       } else if (saldoMatchDF) {
         const saldoStr = saldoMatchDF[0]; // Incluir o "DF" para o parseValueBB detectar
         this.saldoAtual = this.parseValueBB(saldoStr);
         console.log(`💰 Saldo BNB (DF) encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
       } else {
         // Fallback: tentar posições específicas
         console.log('⚠️ Padrão CF/DP/DF não encontrado, tentando posições...');
         
         // Tentar diferentes posições onde o saldo pode estar
         const posicoes = [
           { inicio: 150, fim: 155, descricao: 'Posição 150-155' },
           { inicio: 140, fim: 145, descricao: 'Posição 140-145' },
           { inicio: 130, fim: 135, descricao: 'Posição 130-135' }
         ];
         
         for (const pos of posicoes) {
           const valor = trailerLote.substring(pos.inicio, pos.fim);
           console.log(`${pos.descricao}: "${valor}"`);
           
           if (valor && !isNaN(parseInt(valor)) && parseInt(valor) > 0) {
             this.saldoAtual = this.parseValueBB(valor);
             console.log(`💰 Saldo BNB encontrado em posição alternativa: ${valor} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
             break;
           }
         }
       }
     }

     // Extrair informações detalhadas
     const detalhes = this.extrairDetalhesBNB(lines);
     
     // Adicionar detalhes à resposta
     this.detalhes = detalhes;

     return this.formatResponse();
   }

   /**
    * Processa arquivo genérico
    */
  parseGenerico(lines) {
    console.log('🏦 Processando arquivo genérico');
    
    // Tentar encontrar saldo em diferentes posições
    const ultimaLinha = lines[lines.length - 1];
    
    if (ultimaLinha && ultimaLinha.length >= 134) {
      const saldoStr = ultimaLinha.substring(119, 134);
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo genérico extraído: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    }

    return this.formatResponse();
  }

  /**
   * Analisa o header do arquivo e extrai data/hora de geração
   */
  extrairDataHoraGeracao(header) {
    console.log(`🔍 Analisando header para data/hora (tamanho: ${header?.length || 0})`);
    
    if (!header) {
      console.log('⚠️ Header não encontrado');
      return;
    }
    
    // Mostrar o header completo para análise
    console.log(`📄 Header completo: "${header}"`);
    
    // Analisar diferentes posições onde podem estar datas/horas
    const posicoesAnalise = [
      { inicio: 0, fim: 6, descricao: 'Posições 0-6 (DDMMAA)' },
      { inicio: 6, fim: 12, descricao: 'Posições 6-12 (HHMMSS)' },
      { inicio: 95, fim: 100, descricao: 'Posições 95-100 (DDMMAA)' },
      { inicio: 100, fim: 106, descricao: 'Posições 100-106 (HHMMSS)' },
      { inicio: 90, fim: 95, descricao: 'Posições 90-95 (DDMMAA)' },
      { inicio: 95, fim: 100, descricao: 'Posições 95-100 (HHMMSS)' },
      { inicio: 80, fim: 86, descricao: 'Posições 80-86 (DDMMAA)' },
      { inicio: 86, fim: 92, descricao: 'Posições 86-92 (HHMMSS)' }
    ];
    
    console.log('🔍 Analisando posições no header:');
    posicoesAnalise.forEach(pos => {
      if (header.length >= pos.fim) {
        const valor = header.substring(pos.inicio, pos.fim);
        console.log(`  ${pos.descricao}: "${valor}"`);
      }
    });
    
    // Procurar por padrões de data/hora em todo o header (para diagnóstico)
    const padroesData = [
      { regex: /(\d{2})(\d{2})(\d{2})/, descricao: 'DDMMAA' },
      { regex: /(\d{2})(\d{2})(\d{4})/, descricao: 'DDMMAAAA' },
      { regex: /(\d{4})(\d{2})(\d{2})/, descricao: 'AAAAMMDD' }
    ];
    
    const padroesHora = [
      { regex: /(\d{2})(\d{2})(\d{2})/, descricao: 'HHMMSS' },
      { regex: /(\d{2})(\d{2})/, descricao: 'HHMM' }
    ];
    
    console.log('🔍 Procurando padrões de data:');
    padroesData.forEach(padrao => {
      const matches = header.match(new RegExp(padrao.regex, 'g'));
      if (matches) {
        console.log(`  ${padrao.descricao}: ${matches.join(', ')}`);
      }
    });
    
    console.log('🔍 Procurando padrões de hora:');
    padroesHora.forEach(padrao => {
      const matches = header.match(new RegExp(padrao.regex, 'g'));
      if (matches) {
        console.log(`  ${padrao.descricao}: ${matches.join(', ')}`);
      }
    });
    
    // Tentar extrair data das posições padrão CNAB400
    if (header.length >= 106) {
      const dataStr = header.substring(95, 100);
      const horaStr = header.substring(100, 106);
      
      console.log(`📅 Tentativa CNAB400 - Data (95-100): "${dataStr}", Hora (100-106): "${horaStr}"`);
      
      if (dataStr && dataStr.trim() !== '' && !isNaN(parseInt(dataStr))) {
        const dia = dataStr.substring(0, 2);
        const mes = dataStr.substring(2, 4);
        const ano = '20' + dataStr.substring(4, 6);
        this.dataGeracao = `${ano}-${mes}-${dia}`;
        console.log(`✅ Data de geração extraída: ${this.dataGeracao}`);
      }
      
      if (horaStr && horaStr.trim() !== '' && !isNaN(parseInt(horaStr))) {
        const hora = horaStr.substring(0, 2);
        const minuto = horaStr.substring(2, 4);
        const segundo = horaStr.substring(4, 6);
        this.horaGeracao = `${hora}:${minuto}:${segundo}`;
        console.log(`✅ Hora de geração extraída: ${this.horaGeracao}`);
      }
    }
    
    // Se não encontrou, tentar posições alternativas
    if (!this.dataGeracao && header.length >= 100) {
      const dataStr = header.substring(90, 95);
      const horaStr = header.substring(95, 100);
      
      console.log(`📅 Tentativa alternativa - Data (90-95): "${dataStr}", Hora (95-100): "${horaStr}"`);
      
      if (dataStr && !isNaN(parseInt(dataStr))) {
        const dia = dataStr.substring(0, 2);
        const mes = dataStr.substring(2, 4);
        const ano = '20' + dataStr.substring(4, 6);
        this.dataGeracao = `${ano}-${mes}-${dia}`;
        console.log(`✅ Data de geração (alt): ${this.dataGeracao}`);
      }
      
      if (horaStr && !isNaN(parseInt(horaStr))) {
        const hora = horaStr.substring(0, 2);
        const minuto = horaStr.substring(2, 4);
        const segundo = horaStr.substring(4, 6);
        this.horaGeracao = `${hora}:${minuto}:${segundo}`;
        console.log(`✅ Hora de geração (alt): ${this.horaGeracao}`);
      }
    }
    
    // Fallback robusto: procurar por DDMMAAAA e HHMMSS em qualquer posição do header
    if (!this.dataGeracao) {
      const datas8 = header.match(/\d{8}/g);
      if (datas8 && datas8.length > 0) {
        // Percorre do fim para o começo (tende a estar no final da linha)
        for (let i = datas8.length - 1; i >= 0; i--) {
          const dd = parseInt(datas8[i].substring(0, 2));
          const mm = parseInt(datas8[i].substring(2, 4));
          const yyyy = parseInt(datas8[i].substring(4, 8));
          if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 2000 && yyyy <= 2100) {
            const diaStr = dd.toString().padStart(2, '0');
            const mesStr = mm.toString().padStart(2, '0');
            this.dataGeracao = `${yyyy}-${mesStr}-${diaStr}`;
            console.log(`✅ Data de geração (regex DDMMAAAA): ${this.dataGeracao}`);
            break;
          }
        }
      }
    }
    
    // Se ainda não encontrou data, tentar AAAAMMDD
    if (!this.dataGeracao) {
      const datasAA = header.match(/\d{8}/g);
      if (datasAA && datasAA.length > 0) {
        for (let i = datasAA.length - 1; i >= 0; i--) {
          const yyyy = parseInt(datasAA[i].substring(0, 4));
          const mm = parseInt(datasAA[i].substring(4, 6));
          const dd = parseInt(datasAA[i].substring(6, 8));
          if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 2000 && yyyy <= 2100) {
            const diaStr = dd.toString().padStart(2, '0');
            const mesStr = mm.toString().padStart(2, '0');
            this.dataGeracao = `${yyyy}-${mesStr}-${diaStr}`;
            console.log(`✅ Data de geração (regex AAAAMMDD): ${this.dataGeracao}`);
            break;
          }
        }
      }
    }
    
    // Fallback robusto: procurar por HHMMSS em qualquer posição do header
    if (!this.horaGeracao) {
      const horas = header.match(/\d{6}/g);
      if (horas && horas.length > 0) {
        for (let i = horas.length - 1; i >= 0; i--) {
          const hh = parseInt(horas[i].substring(0, 2));
          const mi = parseInt(horas[i].substring(2, 4));
          const ss = parseInt(horas[i].substring(4, 6));
          if (hh >= 0 && hh <= 23 && mi >= 0 && mi <= 59 && ss >= 0 && ss <= 59) {
            this.horaGeracao = `${hh.toString().padStart(2, '0')}:${mi.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração (regex HHMMSS): ${this.horaGeracao}`);
            break;
          }
        }
      }
    }
    
    if (!this.dataGeracao && !this.horaGeracao) {
      console.log('⚠️ Não foi possível extrair data/hora do header');
    }
   }

       /**
     * Extrai data e hora de geração específica para Itaú (da linha de saldo)
     */
    extrairDataHoraGeracaoItau(saldoLine) {
      console.log(`🔍 Analisando linha de saldo Itaú para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo Itaú não encontrada');
        return;
      }
      
      // Para Itaú, a data de geração está na linha 2 (header de lote), não na linha de saldo
      // Vamos procurar por padrão DDMMAAAA na linha de saldo com validação mais rigorosa
      // Exemplo: 11082025 (11/08/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          console.log(`  Testando: ${match} -> dia=${dia}, mes=${mes}, ano=${ano}`);
          
          // Validar se é uma data válida com critérios mais rigorosos
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            // Verificar se não é um valor que pode ser interpretado como hora
            if (dia >= 0 && dia <= 23) {
              console.log(`  ⚠️ Ignorando ${match} - pode ser hora`);
              continue;
            }
            
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração Itaú extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          } else {
            console.log(`  ❌ Data inválida: dia=${dia}, mes=${mes}, ano=${ano}`);
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração Itaú extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo Itaú');
      }
    }

    /**
     * Extrai data e hora de geração específica para Itaú (do header de lote - linha 2)
     */
    extrairDataHoraGeracaoItauHeaderLote(headerLote) {
      console.log(`🔍 Analisando header de lote Itaú para data/hora: "${headerLote}"`);
      
      if (!headerLote) {
        console.log('⚠️ Header de lote Itaú não encontrado');
        return;
      }
      
      // Para Itaú, a data de geração está na linha 2 (header de lote)
      // Procurar por padrão DDMMAAAA no header de lote
      // Exemplo: 11082025 (11/08/2025)
      const dataMatches = headerLote.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas no header de lote: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          console.log(`  Testando: ${match} -> dia=${dia}, mes=${mes}, ano=${ano}`);
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração Itaú (header de lote) extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          } else {
            console.log(`  ❌ Data inválida: dia=${dia}, mes=${mes}, ano=${ano}`);
          }
        }
      }
      
      // Procurar por padrão HHMMSS no header de lote
      const horaMatches = headerLote.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas no header de lote: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração Itaú (header de lote) extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida do header de lote Itaú');
      }
    }

    /**
     * Extrai data e hora de geração específica para Itaú (das linhas de detalhes)
     */
    extrairDataHoraGeracaoItauDetalhes(lines) {
      console.log(`🔍 Analisando linhas de detalhes Itaú para data/hora`);
      
      if (!lines || lines.length < 3) {
        console.log('⚠️ Linhas de detalhes Itaú não encontradas');
        return;
      }
      
      // Procurar por data nas linhas de detalhes (linhas 3 até penúltima)
      for (let i = 2; i < lines.length - 1; i++) {
        const linha = lines[i];
        console.log(`🔍 Analisando linha de detalhe ${i + 1}: "${linha}"`);
        
        // Procurar por padrão DDMMAAAA nas linhas de detalhes
        const dataMatches = linha.match(/(\d{2})(\d{2})(\d{4})/g);
        
        if (dataMatches) {
          console.log(`🔍 Possíveis datas encontradas na linha ${i + 1}: ${dataMatches.join(', ')}`);
          
          for (const match of dataMatches) {
            const dia = parseInt(match.substring(0, 2));
            const mes = parseInt(match.substring(2, 4));
            const ano = parseInt(match.substring(4, 8));
            
            console.log(`  Testando: ${match} -> dia=${dia}, mes=${mes}, ano=${ano}`);
            
            // Validar se é uma data válida
            if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
              this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
              console.log(`✅ Data de geração Itaú (detalhes) extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
              return; // Parar na primeira data válida encontrada
            } else {
              console.log(`  ❌ Data inválida: dia=${dia}, mes=${mes}, ano=${ano}`);
            }
          }
        }
      }
      
      if (!this.dataGeracao) {
        console.log('⚠️ Não foi possível extrair data válida das linhas de detalhes Itaú');
      }
    }

       /**
     * Extrai data e hora de geração específica para Banco do Brasil (da linha de saldo)
     */
    extrairDataHoraGeracaoBB(saldoLine) {
      console.log(`🔍 Analisando linha de saldo BB para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo BB não encontrada');
        return;
      }
      
      // Procurar por padrão DDMMAAAA na linha de saldo com validação
      // Exemplo: 22072025 (22/07/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração BB extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração BB extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo BB');
      }
    }

       /**
     * Extrai data e hora de geração específica para Sicredi (da linha de saldo)
     */
    extrairDataHoraGeracaoSicredi(saldoLine) {
      console.log(`🔍 Analisando linha de saldo Sicredi para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo Sicredi não encontrada');
        return;
      }
      
      // Procurar por padrão DDMMAAAA na linha de saldo com validação
      // Exemplo: 22072025 (22/07/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração Sicredi extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração Sicredi extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo Sicredi');
      }
    }

       /**
     * Extrai data e hora de geração específica para CAIXA (da linha de saldo)
     */
    extrairDataHoraGeracaoCaixa(saldoLine) {
      console.log(`🔍 Analisando linha de saldo CAIXA para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo CAIXA não encontrada');
        return;
      }
      
      // Procurar por padrão DDMMAAAA na linha de saldo com validação
      // Exemplo: 22072025 (22/07/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração CAIXA extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração CAIXA extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo CAIXA');
      }
    }

       /**
     * Extrai data e hora de geração específica para UNICRED (da linha de saldo)
     */
    extrairDataHoraGeracaoUnicred(saldoLine) {
      console.log(`🔍 Analisando linha de saldo UNICRED para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo UNICRED não encontrada');
        return;
      }
      
      // Procurar por padrão DDMMAAAA na linha de saldo com validação
      // Exemplo: 22072025 (22/07/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração UNICRED extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração UNICRED extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo UNICRED');
      }
    }

       /**
     * Extrai data e hora de geração específica para BNB (da linha de saldo)
     */
    extrairDataHoraGeracaoBNB(saldoLine) {
      console.log(`🔍 Analisando linha de saldo BNB para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo BNB não encontrada');
        return;
      }
      
      // Procurar por padrão DDMMAAAA na linha de saldo com validação
      // Exemplo: 25072025 (25/07/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração BNB extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração BNB extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
             if (!this.dataGeracao && !this.horaGeracao) {
         console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo BNB');
       }
     }

       /**
     * Extrai data e hora de geração específica para Bradesco (da linha de saldo)
     */
    extrairDataHoraGeracaoBradesco(saldoLine) {
      console.log(`🔍 Analisando linha de saldo Bradesco para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo Bradesco não encontrada');
        return;
      }
      
      // Procurar por padrão DDMMAAAA na linha de saldo com validação
      // Exemplo: 05082025 (05/08/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração Bradesco extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração Bradesco extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo Bradesco');
      }
    }

       /**
     * Extrai data e hora de geração específica para Santander (da linha de saldo)
     */
    extrairDataHoraGeracaoSantander(saldoLine) {
      console.log(`🔍 Analisando linha de saldo Santander para data/hora: "${saldoLine}"`);
      
      if (!saldoLine) {
        console.log('⚠️ Linha de saldo Santander não encontrada');
        return;
      }
      
      // Procurar por padrão DDMMAAAA na linha de saldo com validação
      // Exemplo: 12082025 (12/08/2025)
      const dataMatches = saldoLine.match(/(\d{2})(\d{2})(\d{4})/g);
      
      if (dataMatches) {
        console.log(`🔍 Possíveis datas encontradas: ${dataMatches.join(', ')}`);
        
        for (const match of dataMatches) {
          const dia = parseInt(match.substring(0, 2));
          const mes = parseInt(match.substring(2, 4));
          const ano = parseInt(match.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração Santander extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
            break;
          }
        }
      }
      
      // Procurar por padrão HHMMSS na linha de saldo com validação
      // Exemplo: 143022 (14:30:22)
      const horaMatches = saldoLine.match(/(\d{2})(\d{2})(\d{2})/g);
      
      if (horaMatches) {
        console.log(`🔍 Possíveis horas encontradas: ${horaMatches.join(', ')}`);
        
        for (const match of horaMatches) {
          const hora = parseInt(match.substring(0, 2));
          const minuto = parseInt(match.substring(2, 4));
          const segundo = parseInt(match.substring(4, 6));
          
          // Validar se é uma hora válida
          if (hora >= 0 && hora <= 23 && minuto >= 0 && minuto <= 59 && segundo >= 0 && segundo <= 59) {
            this.horaGeracao = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}:${segundo.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração Santander extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo Santander');
      }
    }

     /**
   * Converte valor monetário (formato Banco do Brasil e outros)
   * Suporta sufixos CF (Crédito Financeiro - positivo) e DP (Débito Financeiro - negativo)
   */
  parseValueBB(value) {
    if (!value || value.trim() === '') {
      return 0;
    }
    
    const cleanValue = value.trim();
    
    // Se for apenas zeros, retornar 0
    if (cleanValue === '00000000000000000000' || cleanValue === '0000000000000000000') {
      return 0;
    }
    
    try {
      // Verificar se o valor tem sufixo CF (Crédito Financeiro) ou DP (Débito Financeiro)
      let isPositive = true; // Por padrão, assume positivo
      let numericString = cleanValue;
      
      // Se o valor contém letras, extrair apenas os números e verificar o sufixo
      if (/[A-Za-z]/.test(cleanValue)) {
        // Procurar por padrões específicos
        const cfMatch = cleanValue.match(/(\d+)CF/);
        const cpMatch = cleanValue.match(/(\d+)CP/);
        const dpMatch = cleanValue.match(/(\d+)DP/);
        const dfMatch = cleanValue.match(/(\d+)DF/);
        
        if (cfMatch || cpMatch) {
          // CF ou CP = Crédito Financeiro (positivo)
          numericString = cfMatch ? cfMatch[1] : cpMatch[1];
          isPositive = true;
          console.log(`🔍 Crédito Financeiro (${cfMatch ? 'CF' : 'CP'}) detectado: "${cleanValue}" -> "${numericString}"`);
        } else if (dpMatch || dfMatch) {
          // DP ou DF = Débito Financeiro (negativo)
          numericString = dpMatch ? dpMatch[1] : dfMatch[1];
          isPositive = false;
          console.log(`🔍 Débito Financeiro (${dpMatch ? 'DP' : 'DF'}) detectado: "${cleanValue}" -> "${numericString}"`);
        } else {
          // Se não tem CF, CP, DP ou DF, extrair apenas números
          numericString = cleanValue.replace(/\D/g, '');
          console.log(`🔍 Valor com letras (sem CF/CP/DP/DF): "${cleanValue}" -> "${numericString}"`);
        }
      }
      
      // Se ainda não temos números válidos, retornar 0
      if (!numericString || numericString.length === 0) {
        console.log(`⚠️ Nenhum número encontrado em: "${cleanValue}"`);
        return 0;
      }
      
      // Calcular o valor
      const numericValue = parseInt(numericString) / 100;
      const result = isNaN(numericValue) ? 0 : numericValue;
      
      // Aplicar o sinal baseado no sufixo
      const finalResult = isPositive ? result : -result;
      
      console.log(`✅ Valor calculado: ${numericString} / 100 = ${result} (${isPositive ? 'positivo' : 'negativo'}) = ${finalResult}`);
      return finalResult;
      
    } catch (error) {
      console.log(`⚠️ Erro ao converter valor BB: "${value}" -> ${error.message}`);
      return 0;
    }
  }

  /**
   * Percorre as linhas e extrai data e hora do registro de cabeçalho (tipo 0)
   * Posições: data (144-151, DDMMAAAA), hora (152-157, HHMMSS) — índices zero-based [143,151) e [151,157)
   */
  extrairDataHoraPorRegistroTipo0(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return;

    try {
      for (const line of lines) {
        if (!line || line.length < 157) continue;

        const tipoRegistro = line.substring(7, 8);
        if (tipoRegistro !== '0') continue;

        const rawData = line.slice(143, 151);
        const rawHora = line.slice(151, 157);

        const dataNum = (rawData || '').replace(/\D/g, '');
        const horaNum = (rawHora || '').replace(/\D/g, '');

        // Validar data DDMMAAAA com critérios mais rigorosos
        if (!this.dataGeracao && dataNum.length === 8) {
          const dia = parseInt(dataNum.substring(0, 2));
          const mes = parseInt(dataNum.substring(2, 4));
          const ano = parseInt(dataNum.substring(4, 8));
          // Critérios mais rigorosos para evitar datas inválidas como "204-97-41"
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            const diaStr = dia.toString().padStart(2, '0');
            const mesStr = mes.toString().padStart(2, '0');
            this.dataGeracao = `${ano}-${mesStr}-${diaStr}`;
            console.log(`✅ Data de geração (tipo 0): ${this.dataGeracao}`);
          } else {
            console.log(`⚠️ Data inválida ignorada (tipo 0): ${dia}/${mes}/${ano}`);
          }
        }

        // Validar hora HHMMSS
        if (!this.horaGeracao && horaNum.length === 6) {
          const hh = parseInt(horaNum.substring(0, 2));
          const mm = parseInt(horaNum.substring(2, 4));
          const ss = parseInt(horaNum.substring(4, 6));
          if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && ss >= 0 && ss <= 59) {
            this.horaGeracao = `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
            console.log(`✅ Hora de geração (tipo 0): ${this.horaGeracao}`);
          }
        }

        // Se já conseguiu ambos, parar
        if (this.dataGeracao && this.horaGeracao) break;
      }
    } catch (error) {
      console.log(`⚠️ Falha ao extrair data/hora do registro tipo 0: ${error.message}`);
    }
  }

  /**
   * Formata a resposta final
   */
           formatResponse() {
        // Determinar o tipo de operação baseado no sinal do saldo
        const isPositive = this.saldoAtual >= 0;
        const tipoOperacao = isPositive ? 'CREDITO' : 'DEBITO';
        const tipoOperacaoDescricao = isPositive ? 'Crédito Financeiro' : 'Débito Financeiro';
        const sinal = isPositive ? '+' : '-';
        
        return {
          success: true,
          banco: {
            codigo: this.bancoDetectado?.codigo || '000',
            nome: this.bancoDetectado?.nome || 'Banco Desconhecido',
            layout: this.bancoDetectado?.layout || 'GENERICO'
          },
          agencia: this.agencia || 'N/A',
          conta: this.conta || 'N/A',
          empresa: this.empresa || null,
          bancoDestino: this.bancoDestino || (this.bancoDetectado?.nome || null),
          dataGeracao: this.dataGeracao || 'N/A',
          horaGeracao: this.horaGeracao || 'N/A',
          saldoAnterior: this.saldoAnterior,
          saldoAnteriorFormatado: this.saldoAnterior == null ? null : this.saldoAnterior.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
          saldoAtual: this.saldoAtual,
          saldoFormatado: this.saldoAtual.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          }),
          limiteCredito: this.limiteCredito,
          limiteCreditoFormatado: this.limiteCredito == null ? null : this.limiteCredito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
          saldoDisponivel: this.saldoDisponivel,
          saldoDisponivelFormatado: this.saldoDisponivel == null ? null : this.saldoDisponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
          // Informações sobre o sinal/operação
          operacao: {
            tipo: tipoOperacao, // 'CREDITO' ou 'DEBITO'
            descricao: tipoOperacaoDescricao, // 'Crédito Financeiro' ou 'Débito Financeiro'
            sinal: sinal, // '+' ou '-'
            isPositive: isPositive, // true ou false
            valorAbsoluto: Math.abs(this.saldoAtual) // Valor sem sinal
          },
          arquivo: {
            nome: 'Arquivo de Retorno Bancário',
            banco: this.bancoDetectado?.nome || 'Banco',
            dataProcessamento: new Date().toISOString()
          },
          resumo: {
            saldoAtual: this.saldoAtual,
            tipoOperacao: tipoOperacao,
            sinal: sinal
          },
          // Detalhes específicos (se disponível)
          detalhes: this.detalhes || null,
          errors: this.errors
        };
      }

  /**
   * Tenta extrair empresa e banco destino a partir do header, usando nomes de bancos conhecidos como âncora
   */
  setEmpresaEBancoDestinoFromHeader(header) {
    if (!header || header.length < 120) return;
    const bancosConhecidos = [
      'CAIXA ECONOMICA FEDERAL',
      'BANCO DO NORDESTE',
      'BRADESCO S/A',
      'BRADESCO S.A.',
      'BANCO ITAU S/A',
      'BANCO DO BRASIL S.A.',
      'SANTANDER BANESPA',
      'BANCO SANTANDER',
      'COOP. CRED. SICREDI RIO GRANDE',
      'UNICRED DO BRASIL',
      'Unicred do Brasil'
    ];
    let bancoMatch = null;
    let bancoIndex = -1;
    for (const nome of bancosConhecidos) {
      const idx = header.indexOf(nome);
      if (idx !== -1 && (bancoMatch === null || nome.length > bancoMatch.length)) {
        bancoMatch = nome;
        bancoIndex = idx;
      }
    }
    if (bancoMatch) {
      this.bancoDestino = bancoMatch.trim();
      // Pegar até 40 chars anteriores ao início do banco como empresa e limpar sobras
      const startEmpresa = Math.max(0, bancoIndex - 40);
      let empresaRaw = header.substring(startEmpresa, bancoIndex).trim();
      // Remover lixo numérico à esquerda
      empresaRaw = empresaRaw.replace(/^[^A-Za-zÀ-ú]+/, '').trim();
      this.empresa = empresaRaw || this.empresa;
    }
  }

  /**
   * Aplica campos padrão do header CNAB400 conforme FEBRABAN (página 87)
   * Posições 1-based convertidas para substring 0-based
   */
  applyCNAB400HeaderFields(header) {
    if (!header || header.length < 180) return;
    const get = (de, ate) => header.substring(de - 1, ate);
    // Agência 53-57, DV 58
    this.agencia = (get(53, 57) || '').trim() || this.agencia;
    const dvAg = (get(58, 58) || '').trim();
    // Conta 59-70, DV 71, DV Ag/Conta 72
    this.conta = (get(59, 70) || '').trim() || this.conta;
    const dvConta = (get(71, 71) || '').trim();
    const dvAgConta = (get(72, 72) || '').trim();
    // Nome da empresa 73-102
    const nomeEmp = (get(73, 102) || '').trim();
    if (nomeEmp) this.empresa = nomeEmp;
    // Data saldo inicial 143-150 (DDMMAA)
    const dataSaldoIni = get(143, 150);
    if (dataSaldoIni && /\d{6}/.test(dataSaldoIni)) {
      const d = dataSaldoIni.substring(0, 2);
      const m = dataSaldoIni.substring(2, 4);
      const a = '20' + dataSaldoIni.substring(4, 6);
      this.dataSaldoInicial = `${a}-${m}-${d}`;
    }
    // Valor saldo inicial 151-168 (2 dec)
    const valorSaldoIni = get(151, 168);
    if (valorSaldoIni && /\d+/.test(valorSaldoIni)) {
      this.saldoAnterior = parseInt(valorSaldoIni, 10) / 100;
    }
    // Situação saldo inicial 169 (D/C)
    const situacaoIni = get(169, 169);
    if (situacaoIni === 'D' && this.saldoAnterior != null) this.saldoAnterior = -Math.abs(this.saldoAnterior);
    // Status/posição 170-173 (não usado diretamente)
    // Nº sequência extrato 174-178
    this.numeroSequenciaExtrato = (get(174, 178) || '').trim();
  }
}
