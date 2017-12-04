const PQueue = require('p-queue')
const PTimeout = require('p-timeout')
const Url = require('url')
const { omitBy, isNil } = require('lodash')
const Stat = require('./Stat.js')
const runnerSsh = require('./runner-ssh')
const { EventEmitter } = require('events')

const DEFAULT_AUTH = process.env.USER

class Worker extends EventEmitter {
  constructor (uri, config) {
    super()

    // Initialize server definition
    const server = {
      hostname: 'localhost',
      port: 22,
      protocol: 'ssh:',
      auth: DEFAULT_AUTH,
      down: false,
      ...omitBy(Url.parse(uri, true), isNil)
    }

    // Ensure valid protocol
    if (server.protocol !== 'ssh:') {
      throw new Error('Unsupported worker protocol. Only ssh is supported.')
    }

    // Worker config can be overrided by uri query (concurrency, retry)
    config = Object.assign({
      concurrency: 1,
      retry: 0
    }, config, server.query)
    config.concurrency = parseInt(config.concurrency, 10)
    config.retry = parseInt(config.retry, 10)

    // Setup worker instance
    this.uri = uri
    this.server = server
    this.queue = new PQueue({
      concurrency: parseInt(config.concurrency, 10)
    })
    this.stats = new Stat(this.queue)
    this.runner = config.runner || runnerSsh

    this.emit('empty')
  }

  toJSON () {
    return {
      uri: this.uri,
      server: this.server,
      stats: this.stats.toJSON()
    }
  }

  get down () {
    return this.server.down
  }

  get size () {
    return this.queue.size
  }

  get pending () {
    return this.queue.pending
  }

  ping () {
    return this.runner({ cmd: 'hostname' }, this, { log: (_) => _ })
      .then(() => {
        this.server.down = false
        return true
      })
      .catch(() => {
        setTimeout(() => {
          this.ping().catch(_ => _)
        }, 1000)
      })
      .then(() => false)
  }

  add (task) {
    // If the server is down, and the task is
    // not restricted to one server,
    // re-dispatch (without bump retry counter)
    if (!task.worker && this.server.down) {
      this.emit('dispatch', task)
      return
    }

    const logger = { log: (data) => this.emit('log', data) }

    this.stats.total++
    process.nextTick(() => this.emit('add', { task }))

    this.queue.add(() => {
      return PTimeout(this.runner(task, this, logger), task.timeout)
      .then(() => {
        this.stats.success++
        this.stats.done++
        logger.log({ type: 'success', hostname: this.server.hostname, task })
      })
      .catch((error) => {
        if (error.name === 'TimeoutError') {
          this.stats.timeout++
        }

        if (error.code === 255) {
          this.server.down = true
          this.emit('dispatch', task)
          this.emit('down')
          this.ping().catch(_ => _)
          return
        }

        this.server.down = false

        if (task._retried < task.retry) {
          task._retried++
          this.stats.retry++
          logger.log({
            type: 'retry',
            hostname: this.server.hostname,
            task
          })
          this.emit('dispatch', task)
        } else {
          this.stats.error++
          this.stats.done++
          logger.log({
            type: 'fail',
            hostname: this.server.hostname,
            message: 'Unable to perform task. No more retry.',
            task
          })
        }
      })
      .then(() => {
        process.nextTick(() => {
          this.emit('finished', { task })
          if (this.queue.size === 0) {
            this.emit('empty')
          }
        })
      })
    })
  }
}

module.exports = Worker
