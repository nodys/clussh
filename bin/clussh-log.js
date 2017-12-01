#!/usr/bin/env node
const miss = require('mississippi')
const split = require('split2')
const chalk = require('chalk')
const moment = require('moment')

process.stdin
  .pipe(split())
  .pipe(miss.through.obj(function (line, enc, done) {
    try { this.push(JSON.parse(line)) } catch (ignore) {}
    done()
  }))
  .pipe(miss.through.obj(function (data, enc, done) {
    switch (data.type) {
      case 'fail':
        this.push(`[${moment(data.time).format()}] (${data.hostname}) ${chalk.red(data.message)}\n`)
        break
      case 'msg':
        this.push(`[${moment(data.time).format()}] ${chalk.grey(data.message)}\n`)
        break
      case 'stdout':
        this.push(`[${moment(data.time).format()}] (${data.hostname}) ${chalk.white(data.stdout)}\n`)
        break
      case 'stderr':
        this.push(`[${moment(data.time).format()}] (${data.hostname}) ${chalk.yellow(data.stderr)}\n`)
        break
    }
    done()
  }))
  .pipe(process.stdout)
