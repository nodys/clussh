const execa = require('execa')
const miss = require('mississippi')
const split = require('split2')
const PQueue = require('p-queue')
const PTimeout = require('p-timeout')
const nanoIdGen = require('nanoid/generate')
const Url = require('url')
const { omitBy, isNil, padStart } = require('lodash')
const fs = require('fs')

module.exports = clussh

function clussh (config = {}) {
  config = Object.assign({
    host: [],
    concurrency: 4,
    retry: 0,
    timeout: Infinity
  }, config)

  const workers = config.host.map(host => {
    const server = {
      hostname: 'localhost',
      port: 22,
      protocol: 'ssh:',
      auth: process.env.USER,
      down: false,
      ...omitBy(Url.parse(host, true), isNil)
    }

    if (server.protocol !== 'ssh:') {
      throw new Error('Unsupported host protocol. Only ssh is supported.')
    }

    const concurrency = server.query.concurrency ? parseInt(server.query.concurrency) : config.concurrency

    return {
      server: server,
      stats: {
        total: 0,
        error: 0,
        success: 0,
        done: 0,
        timeout: 0,
        retry: 0
      },
      queue: new PQueue({ concurrency })
    }
  })

  const readStream = miss.to.obj((task, enc, done) => {
    const id = nanoIdGen('1234567890abcdef', 10)
    for (let i = 0; i < (task.scale || 1); i++) {
      dispatch({
        uuid: id + '-' + padStart(i, 8, '0'),
        retry: config.retry,
        timeout: config.timeout,
        ...task,
        _retried: 0
      })
    }
    done()
  })

  const writeStream = miss.through.obj()

  const duplexStream = miss.duplex.obj(readStream, writeStream)

  config.logger = {
    write: (data = {}) => {
      writeStream.write({
        type: 'msg',
        time: Date.now(),
        ...data
      })
    }
  }

  function dispatch (task) {
    let worker = workers.reduce((memo, worker) => {
      if (!memo) {
        return worker
      } else {
        return memo.queue.size > worker.queue.size ? worker : memo
      }
    }, null)

    worker.stats.total++

    process.nextTick(logState)

    worker.queue.add(() => {
      return PTimeout(doTask(task, worker, config), task.timeout)
        .then(() => {
          worker.stats.success++
          worker.stats.done++
          config.logger.write({ type: 'success', hostname: worker.server.hostname, task })
        })
        .catch(error => {
          if (error.name === 'TimeoutError') {
            worker.stats.timeout++
          }
          if (task._retried < task.retry) {
            task._retried++
            worker.stats.retry++
            config.logger.write({ type: 'retry', hostname: worker.server.hostname, task })
            dispatch(task)
          } else {
            worker.stats.error++
            worker.stats.done++
            config.logger.write({ type: 'fail', hostname: worker.server.hostname, task })
          }
        })
        .then(() => {
          process.nextTick(logState)
        })
    })
  }

  function logState () {
    config.logger.write({ type: 'dashboard-reset' })
    const stats = []

    for (let worker of workers) {
      let stat = {
        done: worker.stats.done,
        success: worker.stats.success,
        error: worker.stats.error,
        pending: worker.queue.pending,
        size: worker.queue.size,
        retry: worker.stats.retry,
        timeout: worker.stats.timeout,
        total: worker.stats.total
      }
      stats.push(stat)
      config.logger.write({
        type: 'dashboard-state',
        label: worker.server.hostname,
        down: worker.server.down,
        progress: stat
      })
    }

    let allStats = stats.reduce((memo, stat) => {
      Object.keys(memo).forEach(k => { memo[k] += (stat[k] || 0) })
      return memo
    }, { success: 0, error: 0, pending: 0, size: 0, total: 0, retry: 0, timeout: 0, totalDone: 0 })

    config.logger.write({
      type: 'dashboard-state',
      label: 'ALL',
      progress: allStats
    })

    config.logger.write({ type: 'dashboard-flush' })
  }

  return duplexStream
}

function doTask (task, worker, config) {
  return new Promise((resolve, reject) => {
    config.logger.write({ type: 'start', hostname: worker.server.hostname, task })
    let cmd = 'bash /dev/stdin'
    let run = execa('ssh', [
      '-t',
      '-t',
      '-p', worker.server.port,
      '-oStrictHostKeyChecking=no',
      worker.server.auth + '@' + worker.server.hostname,
      `${cmd} ${(task.args || []).join(' ')}`],
      {
        input: fs.createReadStream(config.shellFilepath),
        cleanup: true
      }
    )
    run.stdout.pipe(split()).pipe(miss.through((chunk, enc, done) => {
      config.logger.write({ type: 'stdout', hostname: worker.server.hostname, stdout: chunk.toString(), task })
      done()
    }))
    run.stderr.pipe(split()).pipe(miss.through((chunk, enc, done) => {
      config.logger.write({ type: 'stderr', hostname: worker.server.hostname, stderr: chunk.toString(), task })
      done()
    }))

    run.on('exit', (code) => {
      config.logger.write({ type: 'exit', hostname: worker.server.hostname, code, task })
      if (code) {
        if (code === 255) {
          worker.server.down = true
        }
        let error = new Error('Exit with code ' + code)
        reject(error)
      } else {
        worker.server.down = false
        resolve()
      }
    })
  })
}
