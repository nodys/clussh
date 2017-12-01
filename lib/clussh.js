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

  const writeStream = miss.through.obj()

  config.logger = {
    write: (data = {}) => {
      writeStream.write({
        type: 'msg',
        time: Date.now(),
        ...data
      })
    }
  }

  const readStream = miss.to.obj((task, enc, done) => {
    const id = nanoIdGen('1234567890abcdef', 10)
    for (let i = 0; i < (task.scale || 1); i++) {
      dispatch({
        uuid: id + '-' + padStart(i, 8, '0'),
        retry: config.retry,
        timeout: config.timeout,
        cmd: config.cmd,
        script: config.script,
        ...task,
        _retried: 0
      })
    }
    done()
  })

  const duplexStream = miss.duplex.obj(readStream, writeStream)

  const workers = []

  function ensureWorker (uri) {
    config.logger.write({ message: `Ensure worker ${uri}` })
    const current = workers.find(w => w.uri === uri)

    if (current) {
      return current
    }

    const server = {
      hostname: 'localhost',
      port: 22,
      protocol: 'ssh:',
      auth: process.env.USER,
      down: false,
      ...omitBy(Url.parse(uri, true), isNil)
    }

    if (server.protocol !== 'ssh:') {
      throw new Error('Unsupported host protocol. Only ssh is supported.')
    }

    const concurrency = server.query.concurrency ? parseInt(server.query.concurrency) : config.concurrency

    const worker = {
      uri: uri,
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

    workers.push(worker)

    return worker
  }

  config.host.forEach(ensureWorker)

  function dispatch (task) {
    // Choose a worker for this stack
    let worker
    if (task.worker) {
      worker = ensureWorker(task.worker)
    } else {
      worker = workers.reduce((memo, worker) => {
        let candidate = worker
        // If candidate is down, pass
        if (candidate.server.down) {
          return memo
        }

        // If none allready found, use candidate
        if (!memo) {
          return candidate
        }

        // Use the less filled between candidate & memo
        return (memo.queue.size > candidate.queue.size) ? worker : memo
      }, null)
    }

    // If no worker are available, trigger error
    if (!worker) {
      config.logger.write({ type: 'fail', hostname: null, message: 'No worker found or available for task', task })
      return
    }

    worker.stats.total++

    process.nextTick(logState)

    worker.queue.add(async () => {
      // If the server is down, and the task is
      // not restricted to one server,
      // re-dispatch (without bump retry counter)
      if (!task.worker && worker.server.down) {
        dispatch(task)
        return
      }

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
            config.logger.write({ type: 'fail', hostname: worker.server.hostname, message: 'Unable to perform task. No more retry.', task })
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
    let bash = 'bash /dev/stdin'
    let input = '#!/bin/sh\necho "Hello $(hostname)"\nexit\n'
    if (task.cmd) {
      input = `#!/bin/sh\n${task.cmd}\nexit\n`
    } else if (task.script) {
      input = fs.createReadStream(task.script)
    }
    let run = execa('ssh', [
      '-t',
      '-t',
      '-p', worker.server.port,
      '-oStrictHostKeyChecking=no',
      worker.server.auth + '@' + worker.server.hostname,
      `${bash} ${(task.args || []).join(' ')}`],
      {
        input
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
