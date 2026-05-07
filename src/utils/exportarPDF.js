import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Exporta dados para PDF usando jsPDF + autoTable.
 * @param {string[]} colunas      - Cabeçalhos das colunas
 * @param {any[][]}  linhas       - Linhas de dados (array de arrays)
 * @param {string}   nomeArquivo  - Nome base do arquivo (sem extensão e sem data)
 * @param {string}   [titulo]     - Título exibido no topo do PDF
 * @param {object[]} [colStyles]  - Array de { cellWidth } por coluna (opcional)
 */
export function exportarPDF(colunas, linhas, nomeArquivo, titulo, colStyles) {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const hoje = new Date().toLocaleDateString('pt-BR');

  if (titulo) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 6, 56);
    doc.text(titulo, 14, 14);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Gerado em ${hoje} — ${linhas.length} registro(s)`, 14, 20);
    doc.setDrawColor(0, 6, 56);
    doc.setLineWidth(0.3);
    doc.line(14, 22, pageW - 14, 22);
  }

  const columnStyles = {};
  if (colStyles) {
    colStyles.forEach((s, i) => {
      columnStyles[i] = s;
    });
  }

  autoTable(doc, {
    head: [colunas],
    body: linhas,
    startY: titulo ? 26 : 14,
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [0, 6, 56],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center',
    },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles,
    margin: { left: 14, right: 14 },
    didParseCell(data) {
      // Alinhar colunas numéricas à direita automaticamente
      if (data.section === 'body') {
        const val = String(data.cell.raw ?? '');
        if (/^[\d.,\s]+$/.test(val.trim()) && val.trim().length > 0) {
          data.cell.styles.halign = 'right';
        }
      }
    },
  });

  doc.save(`${nomeArquivo}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
