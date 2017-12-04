const fs = require('fs')
const execa = require('execa')
const split = require('split2')
const miss = require('mississippi')
const PCancelable = require('p-cancelable')

module.exports = function (task, worker, logger) {
  return new PCancelable((onCancel, resolve, reject) => {
    logger.log({ type: 'start', hostname: worker.server.hostname, task })
    let bash = 'bash /dev/stdin'
    let input = '#!/bin/sh\necho "Hello $(hostname)"\nexit\n'

    if (task.cmd) {
      input = `#!/bin/sh\n${task.cmd}\nexit\n`
    } else if (task.script) {
      input = fs.createReadStream(task.script)
    }

    let run = execa('ssh', [
      '-t',
      '-t',
      '-p', worker.server.port || 22,
      '-oStrictHostKeyChecking=no',
      '-oBatchMode=yes',
      worker.server.auth + '@' + worker.server.hostname,
      `${bash} ${(task.args || []).join(' ')}`],
      {
        input
      }
    )

    run.stdout.pipe(split()).pipe(miss.through((chunk, enc, done) => {
      logger.log({ type: 'stdout', hostname: worker.server.hostname, stdout: chunk.toString(), task })
      done()
    }))

    run.stderr.pipe(split()).pipe(miss.through((chunk, enc, done) => {
      logger.log({ type: 'stderr', hostname: worker.server.hostname, stderr: chunk.toString(), task })
      done()
    }))

    onCancel(() => {
      run.kill()
    })

    run.on('exit', (code) => {
      logger.log({ type: 'exit', hostname: worker.server.hostname, code, task })
      if (code) {
        let error = new Error('Exit with code ' + code)
        error.code = code
        reject(error)
      } else {
        resolve()
      }
    })
  })
}
