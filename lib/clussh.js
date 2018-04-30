const miss = require('mississippi')
const nanoIdGen = require('nanoid/generate')
const { padStart } = require('lodash')
const Worker = require('./Worker')
const ms = require('ms')

module.exports = clussh

function clussh (config = {}) {
  const buffer = []

  // Manager level error counter
  let managerErrorCounter = 0

  config = Object.assign({
    worker: [],
    concurrency: 4,
    retry: 0,
    timeout: '10d',
    scale: 1,
    identity: []
  }, config)

  if (typeof config.timeout === 'string') {
    config.timeout = ms(config.timeout)
  }

  const writeStream = miss.through.obj()
  writeStream.log = (data = {}) => {
    writeStream.write({
      type: 'msg',
      time: Date.now(),
      ...data
    })
  }

  const readStream = miss.to.obj((task, enc, done) => {
    const id = task.id || nanoIdGen('1234567890abcdef', 10)
    for (let i = 0; i < (task.scale || config.scale); i++) {
      bufferize({
        retry: config.retry,
        timeout: config.timeout,
        cmd: config.cmd,
        script: config.script,
        ...task,
        uuid: id + '-' + padStart(i, 8, '0'),
        _retried: 0
      })
    }
    setTimeout(done, 100)
    // if (buffer.length > 200) {
    //   setTimeout(done, buffer.length * 10)
    // } else {
    //   setTimeout(done, 100)
    // }
    // process.nextTick(done)
  })

  const duplexStream = miss.duplex.obj(readStream, writeStream)

  const workers = []

  function ensureWorker (uri) {
    let worker = workers.find(w => w.uri === uri)
    if (!worker) {
      worker = new Worker(uri, config)
      workers.push(worker)
      worker.on('log', (data) => writeStream.log(data))
      worker.on('dispatch', (task) => bufferize(task))
      worker.on('add', logState)
      worker.on('finished', logState)
      worker.on('empty', () => {
        if (buffer.length) {
          dispatch(buffer.shift())
        } else {
          // No more task to come from input stream (stream ended)
          // and every task has been processed ? End the duplex stream
          let totalRemain = workers.reduce((memo, w) => w.queue.size + w.queue.pending + memo, 0)
          let moreToCome = duplexStream.writable
          if ((totalRemain === 0) && !moreToCome) {
            process.nextTick(() => {
              workers.forEach(w => { w.closed = true })
              writeStream.end()
            })
          }
        }
      })
    }
    return worker
  }

  config.worker.forEach(ensureWorker)

  function bufferize (task) {
    if (task.worker) {
      ensureWorker(task.worker)
    }

    if (task.worker) {
      dispatch(task)
    } else {
      let emptyWorker = workers.find((worker) => !worker.queue.size && !worker.server.down)
      if (emptyWorker) {
        dispatch(task)
      } else {
        buffer.push(task)
        logState()
      }
    }
  }

  function dispatch (task) {
    // Choose a worker for this stack
    let worker
    if (task.worker) {
      worker = ensureWorker(task.worker)
    } else {
      // Choose a random one among empty workers
      let candidates = workers.filter((worker) => !worker.queue.size && !worker.server.down)
      let size = candidates.length

      if (!size) {
        setTimeout(() => bufferize(task), 500)
        return
      } else {
        worker = candidates[Math.floor(Math.random() * size)]
      }
    }

    // If no worker are available, trigger error
    if (!worker) {
      managerErrorCounter++
      writeStream.log({
        type: 'fail',
        worker: null,
        hostname: null,
        msg: 'No worker found or available for task',
        task
      })
      logState()
      return
    }

    worker.add(task)

    logState()
  }

  function logState () {
    writeStream.log({ type: 'dashboard-reset' })
    const stats = []

    writeStream.log({
      type: 'dashboard-buffer',
      length: buffer.length
    })

    for (let worker of workers) {
      let stat = worker.stats.toJSON()
      stats.push(stat)
      writeStream.log({
        type: 'dashboard-state',
        worker: worker.uri,
        hostname: worker.server.hostname,
        label: worker.server.hostname,
        down: worker.server.down,
        progress: stat
      })
    }

    let allStats = stats.reduce((memo, stat) => {
      Object.keys(memo).forEach(k => { memo[k] += (stat[k] || 0) })
      return memo
    }, {
      success: 0,
      error: managerErrorCounter,
      pending: 0,
      size: 0,
      total: 0,
      retry: 0,
      timeout: 0,
      canceled: 0,
      totalDone: 0,
      buffer: buffer.length
    })

    allStats.total += buffer.length

    writeStream.log({
      type: 'dashboard-state',
      label: 'ALL',
      isSummary: true,
      progress: allStats
    })

    writeStream.log({ type: 'dashboard-flush' })
  }

  return duplexStream
}
