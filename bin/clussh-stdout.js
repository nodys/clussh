#!/usr/bin/env node

const miss = require('mississippi')
const leazyNdJsonStream = require('../lib/leazy-ndjson-stream')

process.stdin
  .pipe(leazyNdJsonStream())
  .pipe(miss.through.obj(function (data, enc, done) {
    switch (data.type) {
      case 'stdout':
        console.log(data.msg)
        break
      case 'stderr':
        console.error(data.msg)
        break
    }
    done()
  }))
