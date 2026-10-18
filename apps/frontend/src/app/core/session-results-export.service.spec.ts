import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionResultsExportService } from './session-results-export.service';
import { trpc } from './trpc.client';

vi.mock('./trpc.client', () => ({
  trpc: {
    session: {
      getExportData: { query: vi.fn() },
      getSessionExportPdf: { query: vi.fn() },
    },
  },
}));

const exportData = {
  sessionId: 'sess-1',
  sessionCode: 'ABC123',
  quizName: 'Demo',
  finishedAt: '2026-03-24T12:30:00.000Z',
  participantCount: 1,
  teamMode: false,
  questions: [{ participantCount: 1 }],
  teamLeaderboard: [],
  bonusTokens: [],
};

const pdf = {
  contentBase64: btoa('%PDF-1.4'),
  fileName: 'arsnova-results-Demo-ABC123.pdf',
  mimeType: 'application/pdf',
};

describe('SessionResultsExportService', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:pdf');
    revokeObjectURL = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    vi.mocked(trpc.session.getExportData.query).mockResolvedValue(exportData);
    vi.mocked(trpc.session.getSessionExportPdf.query).mockResolvedValue(pdf);
    TestBed.configureTestingModule({
      providers: [SessionResultsExportService],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('lädt das PDF herunter, wenn die Abschlusskarte exportiert', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const service = TestBed.inject(SessionResultsExportService);

    await expect(
      service.exportPdfFromSessionCode('ABC123', { profile: 'visual', disposition: 'download' }),
    ).resolves.toBe('pdf-download');
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pdf');
  });

  it('öffnet das PDF in einem neuen Tab, wenn der Host den Plan ansieht', async () => {
    const opened = { opener: {} as Window, document: { title: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    const service = TestBed.inject(SessionResultsExportService);

    await expect(
      service.exportPdfFromSessionCode('ABC123', { profile: 'visual', disposition: 'view' }),
    ).resolves.toBe('pdf-view');
    expect(open).toHaveBeenCalledWith('blob:pdf', '_blank');
    expect(opened.opener).toBeNull();
    expect(opened.document.title).toBe(pdf.fileName);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('fällt auf den Download zurück, wenn das Ansehen-Popup blockiert ist', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const service = TestBed.inject(SessionResultsExportService);

    await expect(
      service.exportPdfFromSessionCode('ABC123', { profile: 'visual', disposition: 'view' }),
    ).resolves.toBe('pdf-download');
    expect(click).toHaveBeenCalledOnce();
  });
});
