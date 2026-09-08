import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { ResumeUpload } from './ResumeUpload';

/**
 * The byte counter under the upload progress bar.
 *
 * `ResumeUpload` carried its own `formatFileSize` with no unit ladder — it divided by
 * 1024*1024 and always printed MB, while the two other copies in this package
 * (`ResumeExportList`, `ResumeManager`) render B/KB/MB. That drift is the same shape as
 * WIC-1382, where a duplicated upload constant went stale and refused a valid 7MB resume.
 *
 * The consequence is not cosmetic rounding. `.toFixed(1)` on MB has one step per 105KB,
 * and the accepted formats here are `.pdf`/`.docx`/`.txt`, which for a resume are
 * routinely 2-80KB. A 42KB .docx renders `0.0 MB / 0.0 MB` at *every* progress event
 * from 0% to 100%: the counter never moves, and it states the file is zero-sized while
 * it is uploading fine.
 *
 * These tests drive a real `progress` event through the real component rather than
 * asserting on the formatter alone, because the bug that matters is the rendered line.
 * A pure-function test would pass on a component that never called the formatter.
 */

vi.mock('../services/api', () => ({
  apiClient: {
    config: { getAuthToken: () => Promise.resolve('test-token'), baseURL: 'http://api.test' },
  },
}));

vi.mock('../services/analytics', () => ({
  track: vi.fn(),
  getSessionId: () => 'test-session',
}));

type ProgressListener = (e: { lengthComputable: boolean; loaded: number; total: number }) => void;

let fireUploadProgress: ProgressListener;

class FakeXHR {
  upload = {
    addEventListener: (type: string, fn: ProgressListener) => {
      if (type === 'progress') fireUploadProgress = fn;
    },
  };
  status = 200;
  responseText = '{}';
  addEventListener() {}
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {}
}

const OriginalXHR = globalThis.XMLHttpRequest;

beforeEach(() => {
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = OriginalXHR;
  vi.restoreAllMocks();
});

/** Select `file` through the real hidden input, so the component's own upload path runs. */
async function startUpload(file: File) {
  const view = render(<ResumeUpload onUploadComplete={vi.fn()} onUploadError={vi.fn()} />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;

  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await waitFor(() => expect(fireUploadProgress).toBeTypeOf('function'));
  return view;
}

function docxOf(bytes: number, name = 'resume.docx') {
  const file = new File(['x'], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  // `File` in jsdom sizes itself from its parts; override so the fixture is the size we mean.
  Object.defineProperty(file, 'size', { value: bytes, configurable: true });
  return file;
}

const KB = 1024;

describe('ResumeUpload progress byte counter', () => {
  it('does not claim a 42KB resume is 0.0 MB while it uploads', async () => {
    const total = 42 * KB;
    const { container } = await startUpload(docxOf(total));

    fireUploadProgress({ lengthComputable: true, loaded: Math.round(total * 0.5), total });

    await waitFor(() => {
      const text = container.textContent ?? '';
      // The defect: `0.0 MB / 0.0 MB (50%)` — a live upload reported as a zero-byte file.
      expect(text).not.toMatch(/0\.0 MB/);
    });
  });

  it('renders the 42KB counter in KB, and it MOVES between progress events', async () => {
    const total = 42 * KB;
    const { container } = await startUpload(docxOf(total));

    fireUploadProgress({ lengthComputable: true, loaded: 10 * KB, total });
    await screen.findByText(/10\.0 KB \/ 42\.0 KB/);
    const atTen = container.textContent ?? '';

    fireUploadProgress({ lengthComputable: true, loaded: 30 * KB, total });
    await screen.findByText(/30\.0 KB \/ 42\.0 KB/);
    const atThirty = container.textContent ?? '';

    // Before the fix both snapshots were the identical string `0.0 MB / 0.0 MB`, so the
    // counter was not merely imprecise — it carried no information at all.
    expect(atThirty).not.toEqual(atTen);
  });

  it('still renders MB once the file is genuinely megabytes', async () => {
    const total = 3 * 1024 * KB;
    await startUpload(docxOf(total, 'big.pdf'));

    fireUploadProgress({ lengthComputable: true, loaded: 1.5 * 1024 * KB, total });

    await screen.findByText(/1\.5 MB \/ 3\.0 MB/);
  });
});
