import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
  forcePathStyle: true,
});

export async function uploadStatement(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getStatementDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    { expiresIn },
  );
}

export async function deleteStatement(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}

/**
 * Fetch an object from S3/MinIO and return its body stream + content-type.
 * Used by the dashboard receipts proxy route to stream images through the
 * backend (the in-cluster MinIO isn't reachable from the browser directly).
 */
export async function getObjectStream(
  key: string,
): Promise<{ body: NodeJS.ReadableStream; contentType: string | undefined }> {
  const resp = await s3.send(
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
  );
  if (!resp.Body) throw new Error(`S3 object ${key} has no body`);
  return {
    body: resp.Body as NodeJS.ReadableStream,
    contentType: resp.ContentType,
  };
}

export async function uploadExport(key: string, body: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: "text/csv",
    }),
  );
}
