#!/usr/bin/env node
const yargs = require('yargs')
const path = require('path')
const rc = require('rc')
const miss = require('mississippi')
const fs = require('fs-extra')
const clussh = require('..')
const ms = require('ms')
const leazyJsonStream = require('../lib/leazy-ndjson-stream.js')

const APPNAME = path.basename(__filename, path.extname(__filename))

const config = yargs
  .usage(`${APPNAME} [options] [script filepath]`)
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
    default: '10d',
    alias: 't',
    coerce: function (value) {
      return ms(value)
    }
  })
  .option('worker', {
    description: 'Repeatable worker uri list',
    type: 'array',
    alias: 'w',
    default: `ssh://${process.env.USER}@localhost`
  })
  .option('concurrency', {
    description: 'Concurrency per worker',
    type: 'number',
    alias: 'c',
    default: 1
  })
  .option('scale', {
    description: 'Default scale',
    alias: 's',
    type: 'number',
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

// Check for the shell script to run (if any)
if (config._[0]) {
  config.script = config._[0]
}

// If a script is provided, must be a file
if (config.script) {
  try {
    if (!fs.statSync(config.script).isFile()) { throw new Error('Script is not a file') }
  } catch (error) {
    console.error('Missing valid worker filepath')
    process.exit(1)
  }
}

// Create a read stream:
// - A list of task from stdout
// - A list of task, generated in order to run on all available worker
let stream

if (process.stdin.isTTY) {
  stream = miss.from.obj(config.worker.map(uri => ({
    worker: uri,
    scale: config.scale
  })))
} else {
  stream = process.stdin
    .pipe(leazyJsonStream())
}

stream
  .pipe(clussh(config))
  .pipe(miss.through.obj(function (data, enc, done) { this.push(JSON.stringify(data) + '\n'); done() }))
  .pipe(process.stdout)
