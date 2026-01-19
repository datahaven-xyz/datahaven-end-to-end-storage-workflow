# DataHaven End-to-End-Storage-Workflow

An end-to-end TypeScript script that walks through the full DataHaven storage workflow against a running network and MSP backend.

This repo is designed to be used alongside the tutorial video and as a clean reference implementation for validating your setup when working with buckets, files, MSPs, and on-chain confirmations.

---

## What this script does

The script (`src/index.ts`) executes the full storage lifecycle:

1. Check MSP backend health  
2. Create a bucket (on-chain)  
3. Verify the bucket exists on-chain  
4. Wait until the MSP backend/indexer recognizes the bucket  
5. Upload a file via the MSP backend  
6. Wait until the backend makes the file available  
8. Download the file  
8. Verify file integrity (original vs downloaded)

This covers both sides of the system:
- **On-chain coordination** (bucket creation, confirmations)
- **Off-chain data transfer** (upload/download via MSP backend)

---

## Prerequisites

- Node.js (LTS recommended)
- pnpm

## Directory structure

```
└── datahaven-project/
    ├── README.md
    ├── package.json
    ├── pnpm-workspace.yaml
    ├── tsconfig.json
    ├── .env.example
    └── src/
        ├── index.ts
        ├── config/
        │   └── networks.ts
        ├── operations/
        │   ├── bucketOperations.ts
        │   └── fileOperations.ts
        └── services/
            ├── clientService.ts
            └── mspService.ts
```

## Install

```bash
pnpm install
```

## Run script

```bash
pnpm tsx src/index.ts
```

!!! note
    Bucket names must be unique. If you run the script multiple times against the same network and MSP, bucket creation will fail because bucket names must be unique.

## Project Overview

The script is intentionally split into small, focused modules:

- **`src/services/clientService.ts`** - Creates and manages wallet client, public client, StorageHub client, Polkadot API client.
- **`src/services/mspService.ts`** - Fetches MSP backend information and methods.
- **`src/operations/bucketOperations.ts`** - Handles bucket creation, on-chain verification, and backend readiness checks.
- **`src/operations/fileOperations.ts`** - Handles file upload, download, confirmation waits, and integrity verification.


