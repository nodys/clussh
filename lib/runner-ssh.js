const fs = require('fs')
const execa = require('execa')
const split = require('split2')
const miss = require('mississippi')
const PCancelable = require('p-cancelable')

function runnerSsh (task, worker, _log) {
  return new PCancelable((onCancel, resolve, reject) => {
    const log = (data) => {
      _log({
        worker: worker.uri,
        hostname: worker.server.hostname,
        task,
        ...data
      })
    }

    log({ type: 'start' })
    
    let bash = 'bash /dev/stdin'
    let input = '#!/bin/sh\necho "Hello $(hostname)"\nexit\n'

    if (task.cmd) {
      input = `#!/bin/sh\n${task.cmd}\nexit\n`
    } else if (task.script) {
      input = fs.createReadStream(task.script)
    }

    let run = runnerSsh.execa('ssh', [
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
      log({ type: 'stdout', msg: chunk.toString() })
      done()
    }))

    run.stderr.pipe(split()).pipe(miss.through((chunk, enc, done) => {
      log({ type: 'stderr', msg: chunk.toString() })
      done()
    }))

    onCancel(() => {
      run.kill()
    })

    run.on('exit', (code) => {
      log({ type: 'exit', code })
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

// For testing, use injectable execa
runnerSsh.execa = execa

module.exports = runnerSsh
