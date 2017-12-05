#!/usr/bin/env node

const clusshLog = require('../lib/clussh-log.js')

process.stdin
  .pipe(clusshLog())
  .pipe(process.stdout)
