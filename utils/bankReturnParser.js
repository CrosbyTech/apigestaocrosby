/**
 * Parser para arquivos de retorno bancário CNAB400 - Itaú
 * Baseado no layout oficial do Itaú
 */

export class BankReturnParser {
  constructor() {
    this.header = null;
    this.transactions = [];
    this.trailer = null;
    this.errors = [];
  }

  /**
   * Processa o arquivo de retorno bancário
   * @param {string} fileContent - Conteúdo do arquivo
   * @returns {Object} Dados processados
   */
  parseFile(fileContent) {
    try {
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      if (lines.length < 3) {
        throw new Error('Arquivo inválido: deve ter pelo menos header, transações e trailer');
      }

      // Processar header (primeira linha)
      this.header = this.parseHeader(lines[0]);
      
      // Processar transações (linhas do meio)
      this.transactions = [];
      for (let i = 1; i < lines.length - 1; i++) {
        const line = lines[i];
        const recordType = line.substring(0, 1);
        
        if (recordType === '1') {
          // Header de lote
          continue;
        } else if (recordType === '3') {
          // Registro de detalhe
          const transaction = this.parseTransaction(line);
          if (transaction) {
            this.transactions.push(transaction);
          }
        } else if (recordType === '5') {
          // Trailer de lote
          continue;
        }
      }
      
      // Processar trailer (última linha)
      this.trailer = this.parseTrailer(lines[lines.length - 1]);
      
      return this.formatResponse();
      
    } catch (error) {
      this.errors.push(error.message);
      throw error;
    }
  }

  /**
   * Processa o header do arquivo
   */
  parseHeader(line) {
    if (line.length < 400) {
      throw new Error('Linha de header inválida');
    }

    return {
      codigoBanco: line.substring(0, 3),
      loteServico: line.substring(3, 7),
      tipoRegistro: line.substring(7, 8),
      usoExclusivo: line.substring(8, 17),
      tipoInscricao: line.substring(17, 18),
      numeroInscricao: line.substring(18, 32),
      codigoConvenio: line.substring(32, 52),
      agencia: line.substring(52, 57),
      digitoAgencia: line.substring(57, 58),
      conta: line.substring(58, 70),
      digitoConta: line.substring(70, 71),
      digitoAgenciaConta: line.substring(71, 72),
      nomeEmpresa: line.substring(72, 102).trim(),
      nomeBanco: line.substring(102, 132).trim(),
      usoExclusivo2: line.substring(132, 142),
      codigoRemessa: line.substring(142, 143),
      dataGeracao: this.parseDate(line.substring(143, 151)),
      horaGeracao: this.parseTime(line.substring(151, 157)),
      numeroSequencial: line.substring(157, 163),
      versaoLayout: line.substring(163, 166),
      densidadeGravacao: line.substring(166, 171),
      usoReservado: line.substring(171, 191),
      usoEmpresa: line.substring(191, 211),
      usoExclusivo3: line.substring(211, 240),
      ocorrencias: line.substring(240, 250)
    };
  }

  /**
   * Processa uma transação
   */
  parseTransaction(line) {
    if (line.length < 400) {
      return null;
    }

    const tipoOperacao = line.substring(9, 10);
    const valor = this.parseValue(line.substring(9, 25));
    const dataOcorrencia = this.parseDate(line.substring(110, 118));
    const valorOcorrencia = this.parseValue(line.substring(118, 134));
    
    return {
      codigoBanco: line.substring(0, 3),
      loteServico: line.substring(3, 7),
      tipoRegistro: line.substring(7, 8),
      numeroSequencial: line.substring(8, 13),
      segmento: line.substring(13, 14),
      tipoMovimento: line.substring(14, 15),
      codigoInstrucao: line.substring(15, 17),
      codigoCamara: line.substring(17, 20),
      codigoBancoFavorecido: line.substring(20, 23),
      agenciaFavorecido: line.substring(23, 28),
      digitoAgenciaFavorecido: line.substring(28, 29),
      contaFavorecido: line.substring(29, 41),
      digitoContaFavorecido: line.substring(41, 42),
      digitoAgenciaContaFavorecido: line.substring(42, 43),
      nomeFavorecido: line.substring(43, 73).trim(),
      numeroDocumento: line.substring(73, 93).trim(),
      dataPagamento: this.parseDate(line.substring(93, 101)),
      tipoMoeda: line.substring(101, 104),
      valorPagamento: valor,
      numeroDocumentoBanco: line.substring(125, 135).trim(),
      dataVencimento: this.parseDate(line.substring(135, 143)),
      valorOriginal: this.parseValue(line.substring(143, 157)),
      valorJuros: this.parseValue(line.substring(157, 171)),
      valorDesconto: this.parseValue(line.substring(171, 185)),
      valorAbatimento: this.parseValue(line.substring(185, 199)),
      valorIOF: this.parseValue(line.substring(199, 213)),
      valorPIS: this.parseValue(line.substring(213, 227)),
      valorCOFINS: this.parseValue(line.substring(227, 241)),
      valorRetencao: this.parseValue(line.substring(241, 255)),
      codigoOcorrencia: line.substring(255, 257),
      dataOcorrencia: dataOcorrencia,
      valorOcorrencia: valorOcorrencia,
      complementoOcorrencia: line.substring(134, 144).trim(),
      codigoBancoCorrespondente: line.substring(144, 147),
      nossoNumero: line.substring(147, 157).trim(),
      usoExclusivo: line.substring(157, 167),
      avisoFavorecido: line.substring(167, 168),
      codigoOcorrencia2: line.substring(168, 170),
      codigoOcorrencia3: line.substring(170, 172),
      codigoOcorrencia4: line.substring(172, 174),
      codigoOcorrencia5: line.substring(174, 176),
      valorOcorrencia2: this.parseValue(line.substring(176, 190)),
      valorOcorrencia3: this.parseValue(line.substring(190, 204)),
      valorOcorrencia4: this.parseValue(line.substring(204, 218)),
      valorOcorrencia5: this.parseValue(line.substring(218, 232)),
      dataEfetivacao: this.parseDate(line.substring(232, 240)),
      valorEfetivacao: this.parseValue(line.substring(240, 254)),
      codigoOcorrencia6: line.substring(254, 256),
      valorOcorrencia6: this.parseValue(line.substring(256, 270)),
      dataEfetivacao2: this.parseDate(line.substring(270, 278)),
      valorEfetivacao2: this.parseValue(line.substring(278, 292)),
      codigoOcorrencia7: line.substring(292, 294),
      valorOcorrencia7: this.parseValue(line.substring(294, 308)),
      dataEfetivacao3: this.parseDate(line.substring(308, 316)),
      valorEfetivacao3: this.parseValue(line.substring(316, 330)),
      codigoOcorrencia8: line.substring(330, 332),
      valorOcorrencia8: this.parseValue(line.substring(332, 346)),
      dataEfetivacao4: this.parseDate(line.substring(346, 354)),
      valorEfetivacao4: this.parseValue(line.substring(354, 368)),
      codigoOcorrencia9: line.substring(368, 370),
      valorOcorrencia9: this.parseValue(line.substring(370, 384)),
      dataEfetivacao5: this.parseDate(line.substring(384, 392)),
      valorEfetivacao5: this.parseValue(line.substring(392, 400)),
      // Campos calculados
      tipoOperacao: tipoOperacao,
      descricaoTipoOperacao: this.getTipoOperacaoDescricao(tipoOperacao),
      descricaoOcorrencia: this.getOcorrenciaDescricao(line.substring(255, 257))
    };
  }

  /**
   * Processa o trailer do arquivo
   */
  parseTrailer(line) {
    if (line.length < 400) {
      throw new Error('Linha de trailer inválida');
    }

    return {
      codigoBanco: line.substring(0, 3),
      loteServico: line.substring(3, 7),
      tipoRegistro: line.substring(7, 8),
      usoExclusivo: line.substring(8, 17),
      quantidadeLotes: parseInt(line.substring(17, 23)),
      quantidadeRegistros: parseInt(line.substring(23, 29)),
      quantidadeContasConciliadas: parseInt(line.substring(29, 35)),
      usoExclusivo2: line.substring(35, 240),
      ocorrencias: line.substring(240, 250)
    };
  }

  /**
   * Converte valor monetário
   */
  parseValue(value) {
    const numericValue = parseInt(value) / 100;
    return numericValue;
  }

  /**
   * Converte data
   */
  parseDate(dateStr) {
    if (!dateStr || dateStr === '00000000') return null;
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4, 8);
    return `${year}-${month}-${day}`;
  }

  /**
   * Converte hora
   */
  parseTime(timeStr) {
    if (!timeStr || timeStr === '000000') return null;
    const hour = timeStr.substring(0, 2);
    const minute = timeStr.substring(2, 4);
    const second = timeStr.substring(4, 6);
    return `${hour}:${minute}:${second}`;
  }

  /**
   * Obtém descrição do tipo de operação
   */
  getTipoOperacaoDescricao(tipo) {
    const tipos = {
      'C': 'Crédito',
      'D': 'Débito',
      'T': 'Transferência'
    };
    return tipos[tipo] || 'Desconhecido';
  }

  /**
   * Obtém descrição da ocorrência
   */
  getOcorrenciaDescricao(codigo) {
    const ocorrencias = {
      '00': 'Pagamento efetuado',
      '01': 'Pagamento não autorizado',
      '02': 'Pagamento não confirmado',
      '03': 'Erro no processamento',
      '04': 'Pagamento cancelado',
      '05': 'Pagamento em processamento',
      '06': 'Pagamento rejeitado',
      '07': 'Pagamento pendente',
      '08': 'Pagamento confirmado',
      '09': 'Pagamento parcial'
    };
    return ocorrencias[codigo] || `Ocorrência ${codigo}`;
  }

  /**
   * Formata a resposta final
   */
  formatResponse() {
    const totalCreditos = this.transactions
      .filter(t => t.tipoOperacao === 'C')
      .reduce((sum, t) => sum + (t.valorPagamento || 0), 0);
    
    const totalDebitos = this.transactions
      .filter(t => t.tipoOperacao === 'D')
      .reduce((sum, t) => sum + (t.valorPagamento || 0), 0);

    return {
      success: true,
      arquivo: {
        nome: this.header?.nomeEmpresa || 'Arquivo de Retorno',
        banco: this.header?.nomeBanco || 'Banco',
        dataGeracao: this.header?.dataGeracao,
        horaGeracao: this.header?.horaGeracao,
        versaoLayout: this.header?.versaoLayout
      },
      resumo: {
        totalTransacoes: this.transactions.length,
        totalCreditos: totalCreditos,
        totalDebitos: totalDebitos,
        saldo: totalCreditos - totalDebitos,
        quantidadeLotes: this.trailer?.quantidadeLotes,
        quantidadeRegistros: this.trailer?.quantidadeRegistros
      },
      transacoes: this.transactions,
      header: this.header,
      trailer: this.trailer,
      errors: this.errors
    };
  }
}
