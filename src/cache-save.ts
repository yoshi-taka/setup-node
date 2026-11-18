import * as core from '@actions/core';
import * as cache from '@actions/cache';
import fs from 'fs';

import {State} from './constants.js';
import {getPackageManagerInfo, PackageManagerInfo} from './cache-utils.js';

// Catch and log any unhandled exceptions.  These exceptions can leak out of the uploadChunk method in
// @actions/toolkit when a failed upload closes the file descriptor causing any in-process reads to
// throw an uncaught exception.  Instead of failing this action, just warn.

process.on('uncaughtException', e => {
  const warningPrefix = '[warning]';
  core.info(`${warningPrefix}${e.message}`);
});

// Added early exit to resolve issue with slow post action step:
export async function run(earlyExit?: boolean) {
  try {
    const cacheLock = core.getState(State.CachePackageManager);

    if (cacheLock) {
      await cachePackages(cacheLock);

      if (earlyExit) {
        process.exit(0);
      }
    } else {
      core.debug(`Caching for '${cacheLock}' is not supported`);
    }
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

const cachePackages = async (packageManager: string) => {
  const state = core.getState(State.CacheMatchedKey);
  const primaryKey = core.getState(State.CachePrimaryKey);
  const cachePaths = JSON.parse(
    core.getState(State.CachePaths) || '[]'
  ) as string[];

  const packageManagerInfo = await getPackageManagerInfo(packageManager);
  if (!packageManagerInfo) {
    core.debug(`Caching for '${packageManager}' is not supported`);
    return;
  }

  if (!cachePaths.length) {
    // TODO: core.getInput has a bug - it can return undefined despite its definition (tests only?)
    //       export declare function getInput(name: string, options?: InputOptions): string;
    const cacheDependencyPath = core.getInput('cache-dependency-path') || '';
    throw new Error(
      `Cache folder paths are not retrieved for ${packageManager} with cache-dependency-path = ${cacheDependencyPath}`
    );
  }

  await saveVerificationLog(packageManagerInfo);

  if (primaryKey === state) {
    core.info(
      `Cache hit occurred on the primary key ${primaryKey}, not saving cache.`
    );
    return;
  }

  const cacheId = await cache.saveCache(cachePaths, primaryKey);
  if (cacheId === -1) {
    // saveCache returns -1 without throwing when the cache was not saved, e.g.
    // a reserve collision or a read-only token (fork PR). @actions/cache has
    // already logged the reason at the appropriate severity, so just trace it.
    core.debug(`Cache was not saved for the key: ${primaryKey}`);
    return;
  }

  core.info(`Cache saved with the key: ${primaryKey}`);
};

/**
 * pnpm's lockfile verification log lets the next job skip a registry-backed
 * verification round trip, so it is saved from every job — including one whose
 * store already hit its primary key, which returns before the store save.
 * The path and key were resolved by the main step and handed over through
 * the action state, so the post step needs no pnpm invocation of its own.
 */
const saveVerificationLog = async (packageManagerInfo: PackageManagerInfo) => {
  if (!packageManagerInfo.getVerificationLogPath) {
    return;
  }
  const logPath = core.getState(State.CacheVerificationLogPath);
  const logKey = core.getState(State.CacheVerificationLogKey);
  if (!logPath || !logKey) {
    // The main step resolved no verification log (older pnpm, or a restore
    // step that did not run), so there is nothing to save.
    core.debug('No pnpm lockfile verification log to cache');
    return;
  }
  if (!fs.existsSync(logPath)) {
    core.debug(
      `No pnpm lockfile verification log at ${logPath}; nothing to cache`
    );
    return;
  }

  try {
    const cacheId = await cache.saveCache([logPath], logKey);
    if (cacheId === -1) {
      core.debug(
        `pnpm lockfile verification cache was not saved for the key: ${logKey}`
      );
      return;
    }
    core.info(`pnpm lockfile verification cache saved with the key: ${logKey}`);
  } catch (error) {
    // A failed save costs the next job only the re-verification; never fail
    // the post step over it.
    core.warning(
      `Failed to save the pnpm lockfile verification cache: ${(error as Error).message}`
    );
  }
};

run(true);
