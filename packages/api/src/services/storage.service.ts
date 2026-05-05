import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getConfig } from '../config.js';

let _client: S3Client | null = null;

export function isR2Configured(): boolean {
  const c = getConfig();
  return !!(c.r2Endpoint && c.r2AccessKeyId && c.r2SecretAccessKey && c.r2Bucket);
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
      // Required for path-style access (MinIO local dev)
      forcePathStyle: true,
    });
  }
  return _client;
}

export function _resetStorageClient(): void {
  _client = null;
}

export async function uploadObject(key: string, body: Buffer, contentType: string): Promise<void> {
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
  const config = getConfig();
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: config.r2Bucket!,
      Key: key,
    })
  );
}

export async function getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const config = getConfig();
  const command = new GetObjectCommand({
    Bucket: config.r2Bucket!,
    Key: key,
  });
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
