/**
 * Serviço para integração com os endpoints de movimentação fiscal (analytics v2)
 * da API TOTVS Moda.
 *
 * Variável de ambiente necessária: VITE_TOTVS_API_TOKEN
 * (Projeto usa Vite — prefixo VITE_, não REACT_APP_)
 */

const TOTVS_BASE_URL = 'https://www30.bhan.com.br:9443/api/totvsmoda';

const getAuthHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${import.meta.env.VITE_TOTVS_API_TOKEN || ''}`,
});

/**
 * Monta o body padrão para todos os endpoints de fiscal-movement.
 * @param {number[]} branchCodeList - Códigos das filiais
 * @param {string} startDate - Data inicial (YYYY-MM-DD ou ISO)
 * @param {string} endDate - Data final (YYYY-MM-DD ou ISO)
 * @param {number} [page=0]
 * @param {number} [pageSize=20]
 */
const buildBody = (branchCodeList, startDate, endDate, page = 0, pageSize = 20) => ({
  filter: {
    branchCodeList: branchCodeList ?? [],
    startMovementDate: startDate ?? '',
    endMovementDate: endDate ?? '',
  },
  page,
  pageSize,
});

/**
 * Faz POST para um endpoint TOTVS analytics e retorna o JSON da resposta.
 * Lança erro com mensagem legível em caso de falha HTTP.
 */
const postTotvsAnalytics = async (path, body) => {
  const url = `${TOTVS_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const err = await response.json();
      detail = err.message || err.error || detail;
    } catch {
      // ignora erros de parse
    }
    throw new Error(`[${response.status}] ${detail}`);
  }

  return response.json();
};

/**
 * Busca movimentação fiscal por operação.
 * @param {number[]} branchCodeList
 * @param {string} startDate
 * @param {string} endDate
 */
export const getOperationsFiscalMovement = (branchCodeList, startDate, endDate) =>
  postTotvsAnalytics(
    '/analytics/v2/operation-fiscal-movement/search',
    buildBody(branchCodeList, startDate, endDate),
  );

/**
 * Busca movimentação fiscal por vendedor.
 * @param {number[]} branchCodeList
 * @param {string} startDate
 * @param {string} endDate
 */
export const getSellerFiscalMovement = (branchCodeList, startDate, endDate) =>
  postTotvsAnalytics(
    '/analytics/v2/seller-fiscal-movement/search',
    buildBody(branchCodeList, startDate, endDate),
  );

/**
 * Busca movimentação fiscal por forma de pagamento.
 * @param {number[]} branchCodeList
 * @param {string} startDate
 * @param {string} endDate
 */
export const getPaymentFiscalMovement = (branchCodeList, startDate, endDate) =>
  postTotvsAnalytics(
    '/analytics/v2/payment-fiscal-movement/search',
    buildBody(branchCodeList, startDate, endDate),
  );
