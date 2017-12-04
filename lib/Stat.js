
class Stat {
  constructor (queue) {
    this._queue = queue
    Object.assign(this, {
      total: 0,
      error: 0,
      success: 0,
      done: 0,
      timeout: 0,
      canceled: 0,
      retry: 0
    })
  }

  toJSON () {
    return {
      total: this.total,
      error: this.error,
      success: this.success,
      done: this.done,
      timeout: this.timeout,
      canceled: this.canceled,
      pending: this._queue.pending,
      size: this._queue.size,
      retry: this.retry
    }
  }

  get pending () {
    return this._queue.pending
  }

  get size () {
    return this._queue.size
  }
}

module.exports = Stat
