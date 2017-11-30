#!/usr/bin/env node
const miss = require('mississippi')
const split = require('split2')
const chalk = require('chalk')

let buffer = []

process.stdin
  .pipe(split())
  .pipe(miss.through.obj(function (line, enc, done) {
    try { this.push(JSON.parse(line)) } catch (ignore) {}
    done()
  }))
  .pipe(miss.through.obj(function (data, enc, done) {
    switch (data.type) {
      case 'dashboard-reset':
        buffer = []
        buffer.push('\x1bc')
        buffer.push(chalk.bold.white('⧟  CLUSSH ⧟') + '\n')
        break
      case 'dashboard-state':
        // let infos = Object.keys(data.progress).map((k) => {
        //   return `${chalk.grey(k)}:${chalk.green(data.progress[k])}`
        // })
        let stats = data.progress
        let infos = []
        infos.push(`${chalk.grey('suc:')}${chalk.green(stats.success)}`)
        infos.push(`${chalk.grey('err:')}${chalk[stats.error ? 'red' : 'green'](stats.error)}`)
        infos.push(`${chalk.grey('ret:')}${chalk[stats.retry ? 'yellow' : 'green'](stats.retry)}`)
        infos.push(`${chalk.grey('out:')}${chalk[stats.timeout ? 'yellow' : 'green'](stats.timeout)}`)
        infos.push(`${chalk.grey('tot:')}${chalk.green(stats.total)}`)
        let prog = progress(stats)
        let label
        if (data.down) {
          label = chalk.bold.red(data.label + ' ✗')
        } else {
          label = chalk.bold.blue(data.label)
        }
        buffer.push(`${label} ${infos.join(' ')}\n${prog}\n\n`)
        break
      case 'dashboard-flush':
        this.push(buffer.join(''))
        buffer = []
        break
    }
    done()
  }))
  .pipe(process.stdout)

function progress ({success, error, pending, size, total}) {
  return chalk.green('▉').repeat(success) +
         chalk.red('▉').repeat(error) +
         chalk.yellow('▉').repeat(pending) +
         chalk.grey('▉').repeat(size)
}
