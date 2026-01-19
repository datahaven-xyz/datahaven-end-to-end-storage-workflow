import { createReadStream, statSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { FileManager, ReplicationLevel } from '@storagehub-sdk/core';
import { TypeRegistry } from '@polkadot/types';
import { AccountId20, H256 } from '@polkadot/types/interfaces';
import { storageHubClient, address, publicClient, polkadotApi, account } from '../services/clientService.js';
import { mspClient, getMspInfo, authenticateUser } from '../services/mspService.js';
import { DownloadResult } from '@storagehub-sdk/msp-client';
import { PalletFileSystemStorageRequestMetadata } from '@polkadot/types/lookup';

export async function uploadFile(bucketId: string, filePath: string, fileName: string) {
  //   ISSUE STORAGE REQUEST

  // Set up FileManager
  const fileSize = statSync(filePath).size;
  const fileManager = new FileManager({
    size: fileSize,
    stream: () => Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
  });

  // Get file details

  const fingerprint = await fileManager.getFingerprint();
  console.log(`Fingerprint: ${fingerprint.toHex()}`);

  const fileSizeBigInt = BigInt(fileManager.getFileSize());
  console.log(`File size: ${fileSize} bytes`);

  // Get MSP details

  // Fetch MSP details from the backend (includes its on-chain ID and libp2p addresses)
  const { mspId, multiaddresses } = await getMspInfo();
  // Ensure the MSP exposes at least one multiaddress (required to reach it over libp2p)
  if (!multiaddresses?.length) {
    throw new Error('MSP multiaddresses are missing');
  }
  // Extract the MSP’s libp2p peer IDs from the multiaddresses
  // Each address should contain a `/p2p/<peerId>` segment
  const peerIds: string[] = extractPeerIDs(multiaddresses);
  // Validate that at least one valid peer ID was found
  if (peerIds.length === 0) {
    throw new Error('MSP multiaddresses had no /p2p/<peerId> segment');
  }

  // Extracts libp2p peer IDs from a list of multiaddresses.
  // A multiaddress commonly ends with `/p2p/<peerId>`, so this function
  // splits on that delimiter and returns the trailing segment when present.
  function extractPeerIDs(multiaddresses: string[]): string[] {
    return (multiaddresses ?? []).map((addr) => addr.split('/p2p/').pop()).filter((id): id is string => !!id);
  }

  // Set the redundancy policy for this request.
  // Custom replication allows the client to specify an exact replica count.
  const replicationLevel = ReplicationLevel.Custom;
  const replicas = 1;

  // Issue storage request
  const txHash: `0x${string}` | undefined = await storageHubClient.issueStorageRequest(
    bucketId as `0x${string}`,
    fileName,
    fingerprint.toHex() as `0x${string}`,
    fileSizeBigInt,
    mspId as `0x${string}`,
    peerIds,
    replicationLevel,
    replicas
  );
  console.log('issueStorageRequest() txHash:', txHash);
  if (!txHash) {
    throw new Error('issueStorageRequest() did not return a transaction hash');
  }

  // Wait for storage request transaction
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== 'success') {
    throw new Error(`Storage request failed: ${txHash}`);
  }

  //   VERIFY STORAGE REQUEST ON CHAIN

  // Compute file key
  const registry = new TypeRegistry();
  const owner = registry.createType('AccountId20', account.address) as AccountId20;
  const bucketIdH256 = registry.createType('H256', bucketId) as H256;
  const fileKey = await fileManager.computeFileKey(owner, bucketIdH256, fileName);

  // Verify storage request on chain
  const storageRequest = await polkadotApi.query.fileSystem.storageRequests(fileKey);
  if (!storageRequest.isSome) {
    throw new Error('Storage request not found on chain');
  }

  // Read the storage request data
  const storageRequestData = storageRequest.unwrap().toHuman();
  console.log('Storage request data:', storageRequestData);
  console.log('Storage request bucketId matches initial bucketId:', storageRequestData.bucketId === bucketId);
  console.log(
    'Storage request fingerprint matches initial fingerprint',
    storageRequestData.fingerprint === fingerprint.toString()
  );

  //   UPLOAD FILE TO MSP

  // Authenticate bucket owner address with MSP prior to uploading file
  const authProfile = await authenticateUser();
  console.log('Authenticated user profile:', authProfile);

  // Upload file to MSP
  const uploadReceipt = await mspClient.files.uploadFile(
    bucketId,
    fileKey.toHex(),
    await fileManager.getFileBlob(),
    address,
    fileName
  );
  console.log('File upload receipt:', uploadReceipt);

  if (uploadReceipt.status !== 'upload_successful') {
    throw new Error('File upload to MSP failed');
  }

  return { fileKey, uploadReceipt };
}

export async function downloadFile(
  fileKey: H256,
  downloadPath: string
): Promise<{ path: string; size: number; mime?: string }> {
  // Download file from MSP
  const downloadResponse: DownloadResult = await mspClient.files.downloadFile(fileKey.toHex());

  // Check if the download response was successful
  if (downloadResponse.status !== 200) {
    throw new Error(`Download failed with status: ${downloadResponse.status}`);
  }

  // Save downloaded file

  // Create a writable stream to the target file path
  // This stream will receive binary data chunks and write them to disk.
  const writeStream = createWriteStream(downloadPath);
  // Convert the Web ReadableStream into a Node.js-readable stream
  const readableStream = Readable.fromWeb(downloadResponse.stream as any);

  // Pipe the readable (input) stream into the writable (output) stream
  // This transfers the file data chunk by chunk and closes the write stream automatically
  // when finished.
  return new Promise((resolve, reject) => {
    readableStream.pipe(writeStream);
    writeStream.on('finish', async () => {
      const { size } = await import('node:fs/promises').then((fs) => fs.stat(downloadPath));
      const mime = downloadResponse.contentType === null ? undefined : downloadResponse.contentType;

      resolve({
        path: downloadPath,
        size,
        mime, // if available
      });
    });
    writeStream.on('error', reject);
  });
}

// Compares an original file with a downloaded file byte-for-byte
export async function verifyDownload(originalPath: string, downloadedPath: string): Promise<boolean> {
  const originalBuffer = await import('node:fs/promises').then((fs) => fs.readFile(originalPath));
  const downloadedBuffer = await import('node:fs/promises').then((fs) => fs.readFile(downloadedPath));

  return originalBuffer.equals(downloadedBuffer);
}

export async function waitForMSPConfirmOnChain(fileKey: string) {
  const maxAttempts = 10;
  const delayMs = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Check storage request has been confirmed by the MSP on-chain, attempt ${i + 1} of ${maxAttempts}...`);

    const req = await polkadotApi.query.fileSystem.storageRequests(fileKey);
    if (req.isNone) {
      throw new Error(`StorageRequest for ${fileKey} no longer exists on-chain.`);
    }
    const data: PalletFileSystemStorageRequestMetadata = req.unwrap();

    // MSP confirmation
    const mspTuple = data.msp.isSome ? data.msp.unwrap() : null;
    // here convert mspTuple[1] from codec Bool to native boolean by checking isTrue
    const mspConfirmed = mspTuple ? (mspTuple[1] as any).isTrue : false;

    if (mspConfirmed) {
      console.log('Storage request confirmed by MSP on-chain');
      return;
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`FileKey ${fileKey} not ready for download after waiting ${maxAttempts * delayMs} ms`);
}

export async function waitForBackendFileReady(bucketId: string, fileKey: string) {
  const maxAttempts = 144;
  const delayMs = 5000;

  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Checking for file in MSP backend, attempt ${i + 1} of ${maxAttempts}...`);
    try {
      const fileInfo = await mspClient.files.getFileInfo(bucketId, fileKey);

      if (fileInfo.status === 'ready') {
        console.log('File found in MSP backend:', fileInfo);
        return fileInfo; // or `return;` if you prefer
      } else if (fileInfo.status === 'revoked') {
        throw new Error('File upload was cancelled by user');
      } else if (fileInfo.status === 'rejected') {
        throw new Error('File upload was rejected by MSP');
      } else if (fileInfo.status === 'expired') {
        throw new Error(
          'Storage request expired: the required number of BSP replicas was not achieved within the deadline'
        );
      }

      // For any other status (e.g. "pending"), just keep waiting
      console.log(`File status is "${fileInfo.status}", waiting...`);
    } catch (error: any) {
      if (error?.status === 404 || error?.body?.error === 'Not found: Record') {
        console.log('File not yet indexed in MSP backend (404 Not Found). Waiting before retry...');
      } else {
        console.log('Unexpected error while fetching file from MSP:', error);
        throw error;
      }
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Timed out waiting for MSP backend to mark file as ready');
}
