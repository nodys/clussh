const pkg = require('../package.json')
const net = require('net')
const replico = require('replico')
const chalk = require('chalk')

module.exports = clusshRepl

function clusshRepl (clusshCtx, { portControl }) {
  const writeStream = clusshCtx.writeStream

  writeStream.log({ type: 'repl', msg: 'Call openControl', portControl: portControl })

  // Repl
  net.createServer((socket) => {
    writeStream.log({ type: 'repl', msg: 'New control client', remoteAddress: socket.remoteAddress })

    socket.write(chalk`{bold Clussh v${pkg.version}}`)

    let replServer = replico({
      input: socket,
      output: socket,
      terminal: true
    })

    function extendContext (context) {
      Object.keys(clusshCtx).forEach(key => { context[key] = clusshCtx[key] })
    }

    extendContext(replServer.context)

    replServer.on('reset', extendContext)
    replServer.on('exit', () => {
      socket.end()
    })
  }).listen(portControl, function () {
    writeStream.log({ type: 'repl', msg: `Server repl on port ${portControl} - pid: ${process.pid}`, port: portControl, pid: process.pid })
  })
}
