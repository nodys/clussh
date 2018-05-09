#!/usr/bin/env node
const miss = require('mississippi')
const chalk = require('chalk')
const moment = require('moment')
const leazyNdJsonStream = require('./leazy-ndjson-stream')

const MAX_MESSAGE = 10

let buffer = []
let failCount = 0
let messages = []
let taskBufferLen = 0

function pushMessage (data) {
  messages.push(data)
  messages = messages.slice(0 - MAX_MESSAGE)
}

function flush (force) {
  const now = Date.now()
  force = force || !flush.last
  flush.last = flush.last || now
  if (!force && ((now - flush.last) < 10)) {
    return
  }
  flush.last = now
  this.push(buffer.join(''))

  if (failCount) {
    this.push(chalk.bold.red('Fails:') + '\n' + chalk.red('▉').repeat(failCount) + '\n')
  }

  if (messages.length) {
    this.push(chalk.grey(`${messages.slice(-10).map(m => `[${moment(m.time).format()}] ${m.msg}`).join('\n')}\n`))
  }

  buffer = []
}

function progress ({success, error, pending, size, total}) {
  return chalk.green('▉').repeat(success) +
         chalk.red('▉').repeat(error) +
         chalk.hex('#00d7a3')('▉').repeat(pending) +
         chalk.hex('#666666')('▉').repeat(size)
}

function logStream () {
  return miss.through.obj(function (data, enc, done) {
    switch (data.type) {
      case 'fail':
        failCount++
        pushMessage(data)
        break
      case 'msg':
        pushMessage(data)
        break
      case 'dashboard-reset':
        buffer = []
        buffer.push('\x1bc')
        break
      case 'dashboard-buffer':
        taskBufferLen = data.length
        break
      case 'dashboard-state':
        let stats = data.progress
        let infos = []
        infos.push(`${chalk.grey('suc:')}${chalk.green(stats.success)}`)
        infos.push(`${chalk.grey('pen:')}${chalk.green(stats.pending)}`)
        infos.push(`${chalk.grey('err:')}${chalk[stats.error ? 'red' : 'green'](stats.error)}`)
        infos.push(`${chalk.grey('ret:')}${chalk[stats.retry ? 'yellow' : 'green'](stats.retry)}`)
        infos.push(`${chalk.grey('out:')}${chalk[stats.timeout ? 'yellow' : 'green'](stats.timeout)}`)
        infos.push(`${chalk.grey('tot:')}${chalk.green(stats.total)}`)
        let prog = progress(stats)
        if (data.isSummary) {
          prog += chalk.hex('#333333')('▉'.repeat(taskBufferLen))
          infos.push(`${chalk.grey('buf:')}${chalk.green(taskBufferLen)}`)
        }
        let label
        if (data.down) {
          label = chalk.bold.red(data.label + ' ✗')
        } else {
          label = chalk.bold.blue(data.label)
        }
        buffer.push(`${label} ${infos.join(' ')}\n${prog}\n\n`)
        break
      case 'dashboard-flush':
        flush.bind(this)()
        break
    }
    done()
  }, function (done) {
    flush.bind(this)(true)
  })
}

module.exports = function () {
  return miss.pipeline(
    leazyNdJsonStream(),
    logStream()
  )
}
