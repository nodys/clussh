#!/usr/bin/env node

const clusshBoard = require('../lib/clussh-board.js')

process.stdin
  .pipe(clusshBoard())
  .pipe(process.stdout)
