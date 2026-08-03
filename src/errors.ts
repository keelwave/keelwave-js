export class KeelwaveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeelwaveError'
  }
}

export class KeelwaveAuthError extends KeelwaveError {
  constructor(message: string) {
    super(message)
    this.name = 'KeelwaveAuthError'
  }
}

export class KeelwaveValidationError extends KeelwaveError {
  constructor(message: string) {
    super(message)
    this.name = 'KeelwaveValidationError'
  }
}

export class KeelwaveRateLimited extends KeelwaveError {
  readonly retryAfter: number | null

  constructor(message: string, retryAfter: number | null = null) {
    super(message)
    this.name = 'KeelwaveRateLimited'
    this.retryAfter = retryAfter
  }
}

export class KeelwaveBufferFull extends KeelwaveError {
  constructor(message: string) {
    super(message)
    this.name = 'KeelwaveBufferFull'
  }
}

export class KeelwaveServerError extends KeelwaveError {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'KeelwaveServerError'
    this.status = status
  }
}

export class KeelwaveTransportError extends KeelwaveError {
  constructor(message: string) {
    super(message)
    this.name = 'KeelwaveTransportError'
  }
}
