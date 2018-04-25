#!/usr/bin/env node

const clusshLog = require('../lib/clussh-log.js')
const yargs = require('yargs')

process.stdin
  .pipe(clusshLog(yargs.parse()))
  .pipe(process.stdout)
