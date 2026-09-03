import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * WIC-1468 — `listObjectKeys` had no S3 fallback, so every S3-configured (non-Workers)
 * deployment silently got `[]` while `isStorageAvailable()` reported true. That turned the
 * project conflict check, file count and delete cleanup into no-ops.
 *
 * These tests drive the real `listObjectKeys` with the S3 client's `send` stubbed, so they
 * exercise the branch a Workers-binding fake cannot reach.
 */

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: class {
      send = sendMock;
    },
  };
});

const getRequestEnvMock = vi.fn();
vi.mock('../src/db/context.js', () => ({
  getRequestEnv: () => getRequestEnvMock(),
}));

const S3_CONFIG = {
  r2Endpoint: 'https://example.r2.cloudflarestorage.com',
  r2AccessKeyId: 'akid',
  r2SecretAccessKey: 'secret',
  r2Bucket: 'jobtrail-documents',
};

let currentConfig: Record<string, unknown> = { ...S3_CONFIG };
vi.mock('../src/config.js', () => ({
  getConfig: () => currentConfig,
}));

import {
  listObjectKeys,
  deleteObjects,
  isStorageAvailable,
  isR2Configured,
  _resetStorageClient,
} from '../src/services/storage.service.js';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

/** Build a paged ListObjectsV2 response set and wire `send` to walk it. */
function stubS3Pages(pages: { keys: string[]; next?: string }[]) {
  const seenTokens: (string | undefined)[] = [];
  let call = 0;
  sendMock.mockImplementation(async (command: unknown) => {
    const input = (command as { input: { ContinuationToken?: string; Prefix?: string } }).input;
    seenTokens.push(input.ContinuationToken);
    const page = pages[call++];
    return {
      Contents: page.keys.map((Key) => ({ Key })),
      IsTruncated: page.next !== undefined,
      NextContinuationToken: page.next,
    };
  });
  return seenTokens;
}

describe('listObjectKeys — S3 fallback (WIC-1468)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetStorageClient();
    currentConfig = { ...S3_CONFIG };
    getRequestEnvMock.mockReturnValue(undefined); // no Workers R2 binding
  });

  afterEach(() => {
    _resetStorageClient();
  });

  it('the S3 path is the one under test: configured, available, no R2 binding', () => {
    expect(isR2Configured()).toBe(true);
    expect(isStorageAvailable()).toBe(true);
  });

  it('returns the keys under the prefix instead of an empty list', async () => {
    stubS3Pages([{ keys: ['acme/notes.md', 'acme/resume.md'] }]);

    const keys = await listObjectKeys('acme/');

    expect(keys).toEqual(['acme/notes.md', 'acme/resume.md']);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input).toMatchObject({ Bucket: 'jobtrail-documents', Prefix: 'acme/' });
  });

  it('is non-empty for an existing file, so the conflict check can actually fire', async () => {
    // createProjectFile passes a full object key as the prefix and treats a non-empty
    // result as "already exists". Pre-fix this was always [] => silent overwrite.
    stubS3Pages([{ keys: ['acme/notes.md'] }]);

    expect(await listObjectKeys('acme/notes.md')).toHaveLength(1);
  });

  it('still returns an empty list when the prefix genuinely has no objects', async () => {
    stubS3Pages([{ keys: [] }]);

    expect(await listObjectKeys('acme/missing.md')).toEqual([]);
    // Distinguishes "asked S3 and it had nothing" from the old bug's "never asked" —
    // both produce [], so without this assertion the case passes pre-fix.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('follows the continuation token past 1000 objects', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => `acme/f${i}.md`);
    const page2 = Array.from({ length: 250 }, (_, i) => `acme/g${i}.md`);
    const tokens = stubS3Pages([{ keys: page1, next: 'tok-1' }, { keys: page2 }]);

    const keys = await listObjectKeys('acme/');

    expect(keys).toHaveLength(1250);
    expect(keys[0]).toBe('acme/f0.md');
    expect(keys[1249]).toBe('acme/g249.md');
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(tokens).toEqual([undefined, 'tok-1']);
  });

  it('skips entries with no Key rather than emitting undefined', async () => {
    sendMock.mockResolvedValue({
      Contents: [{ Key: 'acme/a.md' }, {}, { Key: 'acme/b.md' }],
      IsTruncated: false,
    });

    expect(await listObjectKeys('acme/')).toEqual(['acme/a.md', 'acme/b.md']);
  });

  it('terminates when IsTruncated is true but no token comes back', async () => {
    sendMock.mockResolvedValue({
      Contents: [{ Key: 'acme/a.md' }],
      IsTruncated: true,
      NextContinuationToken: undefined,
    });

    expect(await listObjectKeys('acme/')).toEqual(['acme/a.md']);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('propagates an S3 error instead of degrading to an empty list', async () => {
    // An empty list means "no files" to every caller; a failed list must not look like that.
    sendMock.mockRejectedValue(new Error('AccessDenied'));

    await expect(listObjectKeys('acme/')).rejects.toThrow('AccessDenied');
  });

  it('returns [] when storage is not configured at all', async () => {
    currentConfig = {
      r2Endpoint: null,
      r2AccessKeyId: null,
      r2SecretAccessKey: null,
      r2Bucket: null,
    };

    expect(isStorageAvailable()).toBe(false);
    expect(await listObjectKeys('acme/')).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('listObjectKeys — Workers R2 cursor loop (WIC-1468)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetStorageClient();
    currentConfig = { ...S3_CONFIG };
  });

  function bindR2(list: ReturnType<typeof vi.fn>, del = vi.fn()) {
    getRequestEnvMock.mockReturnValue({ R2_BUCKET: { list, delete: del } });
    return del;
  }

  it('pages past the 1000-object limit via the cursor', async () => {
    const list = vi.fn();
    list.mockResolvedValueOnce({
      objects: Array.from({ length: 1000 }, (_, i) => ({ key: `acme/f${i}.md` })),
      truncated: true,
      cursor: 'cur-1',
    });
    list.mockResolvedValueOnce({
      objects: [{ key: 'acme/last.md' }],
      truncated: false,
    });
    bindR2(list);

    const keys = await listObjectKeys('acme/');

    expect(keys).toHaveLength(1001);
    expect(keys[1000]).toBe('acme/last.md');
    expect(list).toHaveBeenNthCalledWith(1, { prefix: 'acme/', limit: 1000, cursor: undefined });
    expect(list).toHaveBeenNthCalledWith(2, { prefix: 'acme/', limit: 1000, cursor: 'cur-1' });
  });

  it('terminates when truncated is true but no cursor is returned', async () => {
    const list = vi.fn().mockResolvedValue({
      objects: [{ key: 'acme/a.md' }],
      truncated: true,
      cursor: undefined,
    });
    bindR2(list);

    expect(await listObjectKeys('acme/')).toEqual(['acme/a.md']);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('deleteObjects batching (WIC-1468)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetStorageClient();
    currentConfig = { ...S3_CONFIG };
  });

  it('chunks the R2 batch delete at 1000 keys', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    getRequestEnvMock.mockReturnValue({ R2_BUCKET: { list: vi.fn(), delete: del } });

    await deleteObjects(Array.from({ length: 2300 }, (_, i) => `acme/f${i}.md`));

    expect(del).toHaveBeenCalledTimes(3);
    expect(del.mock.calls[0][0]).toHaveLength(1000);
    expect(del.mock.calls[1][0]).toHaveLength(1000);
    expect(del.mock.calls[2][0]).toHaveLength(300);
    // Every key is accounted for exactly once.
    const sent = del.mock.calls.flatMap((c) => c[0] as string[]);
    expect(new Set(sent).size).toBe(2300);
  });

  it('is a no-op for an empty key list', async () => {
    const del = vi.fn();
    getRequestEnvMock.mockReturnValue({ R2_BUCKET: { list: vi.fn(), delete: del } });

    await deleteObjects([]);

    expect(del).not.toHaveBeenCalled();
  });
});
