#!/usr/bin/env node
const miss = require('mississippi')
const split = require('split2')
const chalk = require('chalk')
const moment = require('moment')

const MAX_MESSAGE = 10

let buffer = []
let failCount = 0
let messages = []
let taskBufferLen = 0

function pushMessage (data) {
  messages.push(data)
  messages = messages.slice(0 - MAX_MESSAGE)
}

function flush () {
  this.push(buffer.join(''))

  if (failCount) {
    this.push(chalk.bold.red('Fails:') + '\n' + chalk.red('▉').repeat(failCount) + '\n')
  }

  if (messages.length) {
    this.push(chalk.grey(`${messages.slice(-10).map(m => `[${moment(m.time).format()}] ${m.message}`).join('\n')}\n`))
  }

  buffer = []
}

function progress ({success, error, pending, size, total}) {
  return chalk.green('▉').repeat(success) +
         chalk.red('▉').repeat(error) +
         chalk.yellow('▉').repeat(pending) +
         chalk.grey('▉').repeat(size)
}

process.stdin
  .pipe(split())
  .pipe(miss.through.obj(function (line, enc, done) {
    try { this.push(JSON.parse(line)) } catch (ignore) {}
    done()
  }))
  .pipe(miss.through.obj(function (data, enc, done) {
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
        buffer.push(chalk.bold.white('⧟  CLUSSH ⧟') + '\n')
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
    flush.bind(this)()
  }))
  .pipe(process.stdout)
