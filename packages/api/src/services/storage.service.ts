import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from '../config.js';
import { getRequestEnv } from '../db/context.js';
import type { R2Bucket } from '../types/env.js';

let _client: S3Client | null = null;

export function isR2Configured(): boolean {
  const c = getConfig();
  return !!(c.r2Endpoint && c.r2AccessKeyId && c.r2SecretAccessKey && c.r2Bucket);
}

function getR2Binding(): R2Bucket | null {
  return getRequestEnv()?.R2_BUCKET ?? null;
}

export function isStorageAvailable(): boolean {
  return !!getR2Binding() || isR2Configured();
}

function getClient(): S3Client {
  if (!_client) {
    const c = getConfig();
    _client = new S3Client({
      region: 'auto',
      endpoint: c.r2Endpoint!,
      credentials: {
        accessKeyId: c.r2AccessKeyId!,
        secretAccessKey: c.r2SecretAccessKey!,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

export function _resetStorageClient(): void {
  _client = null;
}

export async function uploadObject(
  key: string,
  body: Buffer | string,
  contentType: string
): Promise<void> {
  const r2 = getR2Binding();
  if (r2) {
    const value =
      typeof body === 'string'
        ? new TextEncoder().encode(body)
        : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    await r2.put(key, value, { httpMetadata: { contentType } });
    return;
  }
  const config = getConfig();
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.r2Bucket!,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteObject(key: string): Promise<void> {
  const r2 = getR2Binding();
  if (r2) {
    await r2.delete(key);
    return;
  }
  const config = getConfig();
  await getClient().send(new DeleteObjectCommand({ Bucket: config.r2Bucket!, Key: key }));
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const r2 = getR2Binding();
  if (r2) {
    await r2.delete(keys);
    return;
  }
  await Promise.all(keys.map((k) => deleteObject(k)));
}

export async function getObject(key: string): Promise<Buffer | null> {
  const r2 = getR2Binding();
  if (r2) {
    const obj = await r2.get(key);
    if (!obj) return null;
    return Buffer.from(await obj.arrayBuffer());
  }
  if (isR2Configured()) {
    const config = getConfig();
    try {
      const response = await getClient().send(
        new GetObjectCommand({ Bucket: config.r2Bucket!, Key: key })
      );
      if (!response.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  return null;
}

export async function listObjectKeys(prefix: string): Promise<string[]> {
  const r2 = getR2Binding();
  if (r2) {
    const result = await r2.list({ prefix, limit: 1000 });
    return result.objects.map((o) => o.key);
  }
  return [];
}

export async function getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  // Pre-signed URLs require S3-compatible credentials — the R2 Workers binding has no
  // native signed-URL API. Throw here so callers can surface a 501 cleanly.
  if (!isR2Configured()) {
    throw new Error('S3-compatible credentials are required to generate pre-signed URLs');
  }
  const config = getConfig();
  const command = new GetObjectCommand({ Bucket: config.r2Bucket!, Key: key });
  return awsGetSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

export function buildObjectKey(
  userId: string | null,
  type: 'resumes' | 'resume-exports',
  fileName: string
): string {
  const prefix = userId ?? 'anon';
  return `${prefix}/${type}/${fileName}`;
}
