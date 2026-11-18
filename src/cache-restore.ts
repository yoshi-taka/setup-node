import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import path from 'path';
import fs from 'fs';
import os from 'os';

import {State} from './constants.js';
import {
  getCacheDirectories,
  getPackageManagerInfo,
  repoHasYarnBerryManagedDependencies,
  PackageManagerInfo
} from './cache-utils.js';

export const restoreCache = async (
  packageManager: string,
  cacheDependencyPath: string
) => {
  const packageManagerInfo = await getPackageManagerInfo(packageManager);
  if (!packageManagerInfo) {
    throw new Error(`Caching for '${packageManager}' is not supported`);
  }
  const platform = process.env.RUNNER_OS;
  const arch = os.arch();

  const cachePaths = await getCacheDirectories(
    packageManagerInfo,
    cacheDependencyPath
  );
  core.saveState(State.CachePaths, cachePaths);
  const lockFilePath = cacheDependencyPath
    ? cacheDependencyPath
    : findLockFile(packageManagerInfo);
  const fileHash = await glob.hashFiles(lockFilePath);

  if (!fileHash) {
    throw new Error(
      'Some specified paths were not resolved, unable to cache dependencies.'
    );
  }

  const keyPrefix = `node-cache-${platform}-${arch}-${packageManager}`;
  const primaryKey = `${keyPrefix}-${fileHash}`;
  core.debug(`primary key is ${primaryKey}`);

  core.saveState(State.CachePrimaryKey, primaryKey);
  core.setOutput('cache-primary-key', primaryKey);

  const isManagedByYarnBerry = await repoHasYarnBerryManagedDependencies(
    packageManagerInfo,
    cacheDependencyPath
  );
  let cacheKey: string | undefined;
  if (isManagedByYarnBerry) {
    core.info(
      'All dependencies are managed locally by yarn3, the previous cache can be used'
    );
    cacheKey = await cache.restoreCache(cachePaths, primaryKey, [keyPrefix]);
  } else {
    cacheKey = await cache.restoreCache(cachePaths, primaryKey);
  }

  core.setOutput('cache-hit', Boolean(cacheKey));
  core.setOutput('cache-matched-key', cacheKey);
  core.debug(`cache-matched-key is ${cacheKey}`);

  await restoreVerificationLog(packageManagerInfo, keyPrefix, fileHash);

  if (!cacheKey) {
    core.info(`${packageManager} cache is not found`);
    return;
  }

  core.saveState(State.CacheMatchedKey, cacheKey);
  core.info(`Cache restored from key: ${cacheKey}`);
};

/**
 * pnpm keeps its lockfile verification verdict beside its other caches, not in
 * the store, so the store cache does not carry it. Restore it under its own
 * key: the verdict is only valid for the exact lockfile it was recorded for,
 * so an entry for a different lockfile could never be reused. Restoring the
 * log lets the workflow's upcoming `pnpm install` skip the registry-backed
 * verification round trip; a miss costs exactly what jobs pay today.
 */
const restoreVerificationLog = async (
  packageManagerInfo: PackageManagerInfo,
  keyPrefix: string,
  fileHash: string
) => {
  if (!packageManagerInfo.getVerificationLogPath) {
    return;
  }
  const logPath = await packageManagerInfo.getVerificationLogPath();
  if (!logPath) {
    return;
  }

  const logKey = `${keyPrefix}-verification-${fileHash}`;
  core.saveState(State.CacheVerificationLogPath, logPath);
  core.saveState(State.CacheVerificationLogKey, logKey);

  try {
    const matchedKey = await cache.restoreCache([logPath], logKey);
    if (matchedKey) {
      core.info(
        `pnpm lockfile verification cache restored from key: ${matchedKey}`
      );
    } else {
      core.debug('pnpm lockfile verification cache is not found');
    }
  } catch (error) {
    // The verification log only saves time, never correctness: a job that
    // cannot restore it re-verifies the lockfile and moves on.
    core.warning(
      `Failed to restore the pnpm lockfile verification cache: ${(error as Error).message}`
    );
  }
};

const findLockFile = (packageManager: PackageManagerInfo) => {
  const lockFiles = packageManager.lockFilePatterns;
  const workspace = process.env.GITHUB_WORKSPACE!;

  const rootContent = fs.readdirSync(workspace);

  const lockFile = lockFiles.find(item => rootContent.includes(item));
  if (!lockFile) {
    throw new Error(
      `Dependencies lock file is not found in ${workspace}. Supported file patterns: ${lockFiles.toString()}`
    );
  }

  return path.join(workspace, lockFile);
};
