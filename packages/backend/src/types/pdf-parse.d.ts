declare module 'pdf-parse' {
  interface PDFData {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdfParse(buffer: Buffer, options?: Record<string, unknown>): Promise<PDFData>;
  export = pdfParse;
}
