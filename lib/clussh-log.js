const miss = require('mississippi')
const moment = require('moment')
const chalk = require('chalk')
const leazyNdJsonStream = require('./leazy-ndjson-stream')

module.exports = function (config = {}) {
  return miss.pipeline(
    leazyNdJsonStream(),
    miss.through.obj(function (data, enc, done) {
      // Filter
      if (config.hostname && (data.hostname !== config.hostname)) {
        return done()
      }
      // Only data
      switch (data.type) {
        case 'fail':
          this.push(`[${moment(data.time).format()}] ${data.type} (${chalk.green(data.hostname)}) ${chalk.red(data.msg)}\n`)
          break
        case 'msg':
          this.push(`[${moment(data.time).format()}] ${data.type} (${chalk.green(data.hostname)}) ${chalk.grey(data.msg)}\n`)
          break
        case 'error':
          this.push(`[${moment(data.time).format()}] ${data.type} (${chalk.green(data.hostname)}) ${chalk.red(data.msg)}\n`)
          break
        case 'stdout':
          this.push(`[${moment(data.time).format()}] ${data.type} (${chalk.green(data.hostname)}) ${chalk.white(data.msg)}\n`)
          break
        case 'stderr':
          this.push(`[${moment(data.time).format()}] ${data.type} (${chalk.green(data.hostname)}) ${chalk.yellow(data.msg)}\n`)
          break
      }
      done()
    })
  )
}
