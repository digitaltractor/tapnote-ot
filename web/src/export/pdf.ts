export interface PdfBlock {
  heading?: string;
  text: string;
}

/** Paginated US Letter PDF: title, header lines, blocks, page footer. Mirrors PDFRenderer.swift. */
export async function renderPdf(title: string, headerLines: string[], blocks: PdfBlock[], footer: string): Promise<Blob> {
  // Loaded on demand: the PDF library is the largest dependency.
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 54;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;
  let page = 1;

  const footerAt = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${footer} · Page ${page}`, margin, doc.internal.pageSize.getHeight() - margin / 2);
    doc.setTextColor(0);
  };

  const ensure = (h: number) => {
    if (y + h > bottom) {
      footerAt();
      doc.addPage();
      page++;
      y = margin;
    }
  };

  const write = (text: string, size: number, style: 'normal' | 'bold', color = 0, after = 6) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lineH = size * 1.35;
    for (const line of doc.splitTextToSize(text, width) as string[]) {
      ensure(lineH);
      doc.text(line, margin, y + size);
      y += lineH;
    }
    y += after;
  };

  write(title, 16, 'bold', 0, 4);
  headerLines.forEach((l) => write(l, 10.5, 'normal', 80, 2));
  y += 10;
  for (const b of blocks) {
    if (b.heading) write(b.heading, 11, 'bold', 0, 2);
    write(b.text, 11, 'normal', 0, 10);
  }
  footerAt();
  return doc.output('blob');
}
