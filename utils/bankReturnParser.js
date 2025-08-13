/**
 * Parser para arquivos de retorno bancário - Multi-banco
 * Suporta: Itaú, Banco do Brasil, Sicredi, Unibanco, Santander, Bradesco
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
      this.extrairDataHoraPorRegistroTipo0(lines);

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
     
           // Banco do Brasil: saldo está na penúltima linha (linha 9)
      const trailerLote = lines[lines.length - 2]; // Penúltima linha
      console.log('📏 Linha 9 (trailer lote):', trailerLote);
      console.log('📏 Tamanho da linha:', trailerLote.length);
      
      // Extrair data e hora da linha de saldo também (BB tem data na linha de saldo)
      this.extrairDataHoraGeracaoBB(trailerLote);
      
      if (trailerLote && trailerLote.length >= 200) {
        // Procurar pelo padrão do saldo na linha
        // O valor 210322 está antes do "CF"
        const saldoMatch = trailerLote.match(/(\d{6})CF/);
        
        if (saldoMatch) {
          const saldoStr = saldoMatch[1];
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo BB encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else {
          // Fallback: tentar posições específicas
          console.log('⚠️ Padrão CF não encontrado, tentando posições...');
          
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
      
      // Extrair data e hora de geração do header
      this.extrairDataHoraGeracao(header);
    
    // Itaú: saldo está na penúltima linha (linha 56)
    const saldoLine = lines[lines.length - 2];
    console.log('💰 Processando linha de saldo Itaú:', saldoLine);
    
    // Extrair data e hora da linha de saldo também (Itaú tem data na linha de saldo)
    this.extrairDataHoraGeracaoItau(saldoLine);
    
    const saldoMatch = saldoLine.match(/(\d{7})DP/);
    if (saldoMatch) {
      const saldoStr = saldoMatch[1];
      this.saldoAtual = parseInt(saldoStr) / 100; // Dividir por 100 para converter centavos em reais
      console.log(`💰 Saldo Itaú encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    }

    return this.formatResponse();
  }

  /**
   * Processa arquivo do Bradesco
   */
  parseBradesco(lines) {
    console.log('🏦 Processando arquivo Bradesco');
    
    // Bradesco: saldo está no trailer (última linha)
    const trailer = lines[lines.length - 1];
    
    if (trailer && trailer.length >= 400) {
      // Posições 119-134 contêm o saldo final
      const saldoStr = trailer.substring(119, 134);
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo Bradesco extraído: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    }

    return this.formatResponse();
  }

  /**
   * Processa arquivo do Santander
   */
  parseSantander(lines) {
    console.log('🏦 Processando arquivo Santander');
    
    // Santander: saldo está no trailer (última linha)
    const trailer = lines[lines.length - 1];
    
    if (trailer && trailer.length >= 400) {
      // Posições 119-134 contêm o saldo final
      const saldoStr = trailer.substring(119, 134);
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo Santander extraído: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
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
     
           // Sicredi: saldo está na linha 8 (penúltima linha)
      const trailerLote = lines[lines.length - 2]; // Linha 8
      console.log('📏 Linha 8 (trailer lote):', trailerLote);
      console.log('📏 Tamanho da linha:', trailerLote.length);
      
      // Extrair data e hora da linha de saldo também (Sicredi tem data na linha de saldo)
      this.extrairDataHoraGeracaoSicredi(trailerLote);
      
      if (trailerLote && trailerLote.length >= 200) {
        // Procurar pelo padrão do saldo na linha
        // O valor 5534 está antes do "CP"
        const saldoMatch = trailerLote.match(/(\d{4})CP/);
        
        if (saldoMatch) {
          const saldoStr = saldoMatch[1];
          this.saldoAtual = this.parseValueBB(saldoStr);
          console.log(`💰 Saldo Sicredi encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
        } else {
          // Fallback: tentar posições específicas
          console.log('⚠️ Padrão CP não encontrado, tentando posições...');
          
          // Tentar diferentes posições onde o saldo pode estar
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
      
             // CAIXA: saldo está na linha 6 (penúltima linha)
       const trailerLote = lines[lines.length - 2]; // Linha 6
       console.log('📏 Linha 6 (trailer lote):', trailerLote);
       console.log('📏 Tamanho da linha:', trailerLote.length);
       
       // Extrair data e hora da linha de saldo também (CAIXA tem data na linha de saldo)
       this.extrairDataHoraGeracaoCaixa(trailerLote);
       
       if (trailerLote && trailerLote.length >= 200) {
         // Procurar pelo padrão do saldo na linha
         // O valor 833458 está antes do "CF"
         const saldoMatch = trailerLote.match(/(\d{6})CF/);
         
         if (saldoMatch) {
           const saldoStr = saldoMatch[1];
           this.saldoAtual = this.parseValueBB(saldoStr);
           console.log(`💰 Saldo CAIXA encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
         } else {
           // Fallback: tentar posições específicas
           console.log('⚠️ Padrão CF não encontrado, tentando posições...');
           
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

      return this.formatResponse();
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
      
             // UNICRED: saldo está na linha 4 (penúltima linha)
       const trailerLote = lines[lines.length - 2]; // Linha 4
       console.log('📏 Linha 4 (trailer lote):', trailerLote);
       console.log('📏 Tamanho da linha:', trailerLote.length);
       
       // Extrair data e hora da linha de saldo também (UNICRED tem data na linha de saldo)
       this.extrairDataHoraGeracaoUnicred(trailerLote);
       
       if (trailerLote && trailerLote.length >= 200) {
         // Procurar pelo padrão do saldo na linha
         // O valor 471540 está antes do "DF"
         const saldoMatch = trailerLote.match(/(\d{6})DF/);
         
         if (saldoMatch) {
           const saldoStr = saldoMatch[1];
           this.saldoAtual = this.parseValueBB(saldoStr);
           console.log(`💰 Saldo UNICRED encontrado: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
         } else {
           // Fallback: tentar posições específicas
           console.log('⚠️ Padrão DF não encontrado, tentando posições...');
           
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
            console.log(`✅ Data de geração Itaú extraída: ${this.dataGeracao} (${dia}/${mes}/${ano})`);
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
            console.log(`✅ Hora de geração Itaú extraída: ${this.horaGeracao}`);
            break;
          }
        }
      }
      
      // Se não encontrou, tentar posições específicas
      if (!this.dataGeracao && saldoLine.length >= 8) {
        const dataStr = saldoLine.substring(0, 8); // DDMMAAAA
        console.log(`📅 Tentativa por posições - Data (0-8): "${dataStr}"`);
        
        if (dataStr && !isNaN(parseInt(dataStr))) {
          const dia = parseInt(dataStr.substring(0, 2));
          const mes = parseInt(dataStr.substring(2, 4));
          const ano = parseInt(dataStr.substring(4, 8));
          
          // Validar se é uma data válida
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2030) {
            this.dataGeracao = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
            console.log(`✅ Data de geração Itaú (pos): ${this.dataGeracao}`);
          }
        }
      }
      
      if (!this.dataGeracao && !this.horaGeracao) {
        console.log('⚠️ Não foi possível extrair data/hora válida da linha de saldo Itaú');
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
    * Converte valor monetário (formato Banco do Brasil e outros)
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
      const numericValue = parseInt(cleanValue) / 100;
      return isNaN(numericValue) ? 0 : numericValue;
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

        // Validar data DDMMAAAA
        if (!this.dataGeracao && dataNum.length === 8) {
          const dia = parseInt(dataNum.substring(0, 2));
          const mes = parseInt(dataNum.substring(2, 4));
          const ano = parseInt(dataNum.substring(4, 8));
          if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1900 && ano <= 2100) {
            const diaStr = dia.toString().padStart(2, '0');
            const mesStr = mes.toString().padStart(2, '0');
            this.dataGeracao = `${ano}-${mesStr}-${diaStr}`;
            console.log(`✅ Data de geração (tipo 0): ${this.dataGeracao}`);
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
        return {
          success: true,
          banco: {
            codigo: this.bancoDetectado?.codigo || '000',
            nome: this.bancoDetectado?.nome || 'Banco Desconhecido',
            layout: this.bancoDetectado?.layout || 'GENERICO'
          },
          agencia: this.agencia || 'N/A',
          conta: this.conta || 'N/A',
          dataGeracao: this.dataGeracao || 'N/A',
          horaGeracao: this.horaGeracao || 'N/A',
          saldoAtual: this.saldoAtual,
          saldoFormatado: this.saldoAtual.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          }),
          arquivo: {
            nome: 'Arquivo de Retorno Bancário',
            banco: this.bancoDetectado?.nome || 'Banco',
            dataProcessamento: new Date().toISOString()
          },
          resumo: {
            saldoAtual: this.saldoAtual
          },
          errors: this.errors
        };
      }
}
