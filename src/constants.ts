export enum LockType {
  Npm = 'npm',
  Pnpm = 'pnpm',
  Yarn = 'yarn'
}

export enum State {
  CachePackageManager = 'SETUP_NODE_CACHE_PACKAGE_MANAGER',
  CachePrimaryKey = 'CACHE_KEY',
  CacheMatchedKey = 'CACHE_RESULT',
  CachePaths = 'CACHE_PATHS',
  CacheVerificationLogPath = 'CACHE_VERIFICATION_LOG_PATH',
  CacheVerificationLogKey = 'CACHE_VERIFICATION_LOG_KEY'
}

export enum Outputs {
  CacheHit = 'cache-hit'
}
