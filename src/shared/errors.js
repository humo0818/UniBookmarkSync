/** Custom error classes for sync operations. */

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ConflictError extends Error {
  constructor(message, localTree, remoteTree) {
    super(message);
    this.name = 'ConflictError';
    this.localTree = localTree;
    this.remoteTree = remoteTree;
  }
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}
