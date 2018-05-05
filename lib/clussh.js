const miss = require('mississippi')
const nanoIdGen = require('nanoid/generate')
const { padStart } = require('lodash')
const Worker = require('./Worker')
const ms = require('ms')
const net = require('net')
const replico = require('replico')
const pkg = require('../package.json')
const chalk = require('chalk')

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
    identity: [],
    portControl: 0
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
    addTask(task)
    setTimeout(done, 10)
  })

  const duplexStream = miss.duplex.obj(readStream, writeStream)

  const workers = []

  if (config.portControl) {
    openControl(config.portControl)
  }

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
          // and every task has been processed ? End the duplex stream & clean exit
          let totalRemain = workers.reduce((memo, w) => w.queue.size + w.queue.pending + memo, 0)
          let moreToCome = duplexStream.writable
          if ((totalRemain === 0) && !moreToCome) {
            process.nextTick(() => {
              workers.forEach(w => { w.closed = true })
              writeStream.end()
              process.exit(0) // NB: To quit when a repl is running - should be optional ?
            })
          }
        }
      })
    }
    return worker
  }

  function addTask (task) {
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
  }

  config.worker.forEach(ensureWorker)

  function bufferize (task) {
    if (task.worker) {
      ensureWorker(task.worker)
    }

    if (task.worker) {
      dispatch(task)
    } else {
      let emptyWorker = workers.find((worker) => (worker.queue.pending < worker.concurrency) && !worker.server.down)
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
      let candidates = workers.filter((worker) => (worker.queue.pending < worker.concurrency) && !worker.server.down)
      let size = candidates.length

      if (!size) {
        setTimeout(() => bufferize(task), 500)
        return
      } else {
        worker = candidates[0]
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

  function openControl (portControl) {
    writeStream.log({ type: 'repl', msg: 'Call openControl', portControl: portControl })
    // Repl
    net.createServer((socket) => {
      writeStream.log({ type: 'repl', msg: 'New control client', remoteAddress: socket.remoteAddress })

      socket.write(chalk`{bold Clussh v${pkg.version}}`)

      let replServer = replico({
        input: socket,
        output: socket,
        terminal: true
      })

      function extendContext (context) {
        context.workers = workers
        context.config = config
        context.ensureWorker = ensureWorker
        context.bufferize = bufferize
        context.dispatch = dispatch
        context.readStream = readStream
        context.buffer = buffer
        context.addTask = addTask
        context.readStream = readStream
        context.writeStream = writeStream
        context.duplexStream = duplexStream
      }

      extendContext(replServer.context)

      replServer.on('reset', extendContext)
      replServer.on('exit', () => {
        socket.end()
      })
    }).listen(portControl, function () {
      writeStream.log({ type: 'repl', msg: `Server repl on port ${portControl} - pid: ${process.pid}`, port: portControl, pid: process.pid })
    })
  }

  return duplexStream
}
