#!/usr/bin/env node
const yargs = require('yargs')
const path = require('path')
const rc = require('rc')
const miss = require('mississippi')
const split = require('split2')
const fs = require('fs-extra')
const clussh = require('..')
const ms = require('ms')

const APPNAME = path.basename(__filename, path.extname(__filename))

const config = yargs
  .usage(`${APPNAME} [options] <worker filepath>`)
  .config(rc(APPNAME, {}))
  .option('retry', {
    description: 'How many retry for each task',
    type: 'number',
    default: 0,
    alias: 'r'
  })
  .option('timeout', {
    description: 'Task timeout in millisecond or parseable ms time (eg. 1h, 2d or `3 days`)',
    type: 'string',
    default: '1d',
    coerce: function (value) {
      return ms(value)
    }
  })
  .option('host', {
    description: 'Repeatable host name list using url syntax. Only ssh is supported',
    type: 'array',
    default: `ssh://${process.env.USER}@localhost`
  })
  .option('concurrency', {
    description: 'Concurrency per host',
    type: 'number',
    alias: 'c',
    default: 1
  })
  .option('cmd', {
    description: 'Command to execute',
    type: 'string'
  })
  .option('script', {
    description: 'Script to execute (please ensure proper exit)',
    normalize: true,
    type: 'string'
  })
  .parse()

if (config._[0]) {
  config.script = config._[0]
}

if (config.script) {
  try {
    if (!fs.statSync(config.script).isFile()) { throw new Error('Script is not a file') }
  } catch (error) {
    console.error('Missing valid worker filepath')
    process.exit(1)
  }
}

let stream

if (process.stdin.isTTY) {
  stream = miss.from.obj(config.host.map(uri => ({ worker: uri })))
} else {
  stream = process.stdin
    .pipe(split())
    .pipe(miss.through.obj(function (line, enc, done) {
      try { this.push(JSON.parse(line)) } catch (ignore) {}
      done()
    }))
}

stream
  .pipe(clussh(config))
  .pipe(miss.through.obj(function (data, enc, done) { this.push(JSON.stringify(data) + '\n'); done() }))
  .pipe(process.stdout)
