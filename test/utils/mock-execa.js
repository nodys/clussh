const miss = require('mississippi')
const { EventEmitter } = require('events')

class MockProcess extends EventEmitter {
  constructor ({ code, stdout, stderr, duration }) {
    super()
    this.stdout = streamFromString(stdout)
    this.stderr = streamFromString(stderr)
    this.kill = () => {}

    this.stdout.on('end', () => {
      setTimeout(() => {
        this.emit('exit', code)
      }, duration)
    })
  }
}

function streamFromString (string) {
  return miss.from(function (size, next) {
    if (string.length <= 0) return next(null, null)
    var chunk = string.slice(0, size)
    string = string.slice(size)
    next(null, chunk)
  })
}

function makeMockExeca ({ code = 0, stdout = 'Output from stdout', stderr = 'Output from stderr', duration = 1 } = {}) {
  function execa (cmd, args, options) {
    execa.args = { cmd, args, options }
    const mock = new MockProcess({ code, stdout, stderr, duration })
    return mock
  }

  return execa
}

makeMockExeca.MockProcess = MockProcess

module.exports = makeMockExeca
