import { DOCUMENT } from '@angular/common';
import { Injectable, LOCALE_ID, inject } from '@angular/core';
import type { SessionExportDTO, SessionResultsPdfProfile } from '@arsnova/shared-types';
import {
  buildSessionResultsReportHtml,
  inlineExportImagesInHtml,
} from '@arsnova/session-export-report';
import { getSessionResultsReportLabels } from './session-results-report-labels';
import { printSessionResultsReport } from './session-results-report-print.util';
import { trpc } from './trpc.client';

export type SessionResultsPdfExportResult = 'pdf-download' | 'pdf-view' | 'print-fallback';
export type SessionResultsPdfDisposition = 'download' | 'view';

export interface SessionResultsPdfExportOptions {
  profile?: SessionResultsPdfProfile;
  disposition?: SessionResultsPdfDisposition;
  onLargeReportHint?: (questionCount: number) => void;
}

@Injectable({ providedIn: 'root' })
export class SessionResultsExportService {
  private readonly document = inject(DOCUMENT);
  private readonly localeId = inject(LOCALE_ID) as string;

  async exportPdfFromSessionCode(
    code: string,
    options?: SessionResultsPdfExportOptions,
  ): Promise<SessionResultsPdfExportResult> {
    const exportData = await trpc.session.getExportData.query({
      code: code.toUpperCase(),
    });
    return this.exportPdfFromExportData(exportData, options);
  }

  async exportPdfFromQuizHistory(
    quizId: string,
    accessProof: string,
    options?: SessionResultsPdfExportOptions,
  ): Promise<SessionResultsPdfExportResult> {
    const profile = options?.profile ?? 'visual';
    const exportData = await trpc.session.getLastSessionExportDataForQuiz.query({
      quizId,
      accessProof,
    });
    try {
      const pdf = await trpc.session.getLastSessionExportPdfForQuiz.query({
        quizId,
        accessProof,
        localeId: this.localeId,
        profile,
      });
      return this.deliverPdf(pdf, options?.disposition ?? 'download');
    } catch {
      return this.exportPdfFromExportData(exportData, options);
    }
  }

  private async exportPdfFromExportData(
    exportData: SessionExportDTO,
    options?: SessionResultsPdfExportOptions,
  ): Promise<SessionResultsPdfExportResult> {
    const profile = options?.profile ?? 'visual';
    if (exportData.questions.length >= 15) {
      options?.onLargeReportHint?.(exportData.questions.length);
    }

    try {
      const pdf = await trpc.session.getSessionExportPdf.query({
        code: exportData.sessionCode,
        localeId: this.localeId,
        profile,
      });
      return this.deliverPdf(pdf, options?.disposition ?? 'download');
    } catch {
      const html = await this.buildPrintableReportHtml(exportData, profile);
      const labels = getSessionResultsReportLabels();
      const documentTitle = `${labels.documentTitle} — ${exportData.quizName}`;
      const opened = printSessionResultsReport(html, documentTitle);
      if (!opened) {
        throw new Error('print window blocked');
      }
      return 'print-fallback';
    }
  }

  private async buildPrintableReportHtml(
    exportData: SessionExportDTO,
    profile: SessionResultsPdfProfile,
  ): Promise<string> {
    const labels = getSessionResultsReportLabels();
    const assetBaseUrl = window.location.origin;
    const html = buildSessionResultsReportHtml(exportData, labels, {
      localeId: this.localeId,
      assetBaseUrl,
      pageNumbersViaCss: true,
      pdfUaSafeVisuals: profile === 'pdfUa',
    });
    return inlineExportImagesInHtml(html, { fetchExternal: true, maxImageBytes: 400_000 });
  }

  downloadBase64Export(contentBase64: string, fileName: string, mimeType: string): void {
    const url = this.createBlobUrl(contentBase64, mimeType);
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private deliverPdf(
    pdf: { contentBase64: string; fileName: string; mimeType: string },
    disposition: SessionResultsPdfDisposition,
  ): SessionResultsPdfExportResult {
    if (
      disposition === 'view' &&
      this.openBase64Export(pdf.contentBase64, pdf.fileName, pdf.mimeType)
    ) {
      return 'pdf-view';
    }
    this.downloadBase64Export(pdf.contentBase64, pdf.fileName, pdf.mimeType);
    return 'pdf-download';
  }

  private openBase64Export(contentBase64: string, fileName: string, mimeType: string): boolean {
    const view = this.document.defaultView;
    if (!view) {
      return false;
    }
    const url = this.createBlobUrl(contentBase64, mimeType);
    const opened = view.open(url, '_blank');
    if (!opened) {
      URL.revokeObjectURL(url);
      return false;
    }
    opened.opener = null;
    if (opened.document) {
      opened.document.title = fileName;
    }
    view.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }

  private createBlobUrl(contentBase64: string, mimeType: string): string {
    const binary = atob(contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  }
}
