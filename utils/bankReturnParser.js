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
    
    // Banco do Brasil: saldo está na penúltima linha (trailer de lote)
    // Formato: posições 119-134 contêm o saldo final
    const trailerLote = lines[lines.length - 2]; // Penúltima linha
    
    if (trailerLote && trailerLote.length >= 134) {
      const saldoStr = trailerLote.substring(119, 134);
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo BB extraído: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
    }

    return this.formatResponse();
  }

  /**
   * Processa arquivo do Itaú (CNAB240)
   */
  parseItau(lines) {
    console.log('🏦 Processando arquivo Itaú');
    
    // Itaú: saldo está na penúltima linha (linha 56)
    const saldoLine = lines[lines.length - 2];
    console.log('💰 Processando linha de saldo Itaú:', saldoLine);
    
    const saldoMatch = saldoLine.match(/(\d{7})DP/);
    if (saldoMatch) {
      this.saldoAtual = parseInt(saldoMatch[1]);
      console.log(`💰 Saldo Itaú encontrado: ${this.saldoAtual}`);
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
    
    // Sicredi: saldo está no trailer (última linha)
    const trailer = lines[lines.length - 1];
    
    if (trailer && trailer.length >= 400) {
      // Posições 119-134 contêm o saldo final
      const saldoStr = trailer.substring(119, 134);
      this.saldoAtual = this.parseValueBB(saldoStr);
      console.log(`💰 Saldo Sicredi extraído: ${saldoStr} -> R$ ${this.saldoAtual.toLocaleString('pt-BR')}`);
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
