const Koa = require('koa')
const Router = require('koa-router')
const koaBody = require('koa-body')
const miss = require('mississippi')
const ndjson = require('ndjson')

module.exports = server

function server (clusshCtx, { portHttp = 8080 }) {
  const app = new Koa()
  const router = new Router()

  router.get('/buffer', async ctx => {
    ctx.body = miss.pipe(miss.from.obj(clusshCtx.buffer), ndjson.serialize())
  })

  router.put('/task', koaBody(), async ctx => {
    let tasks = ctx.request.body

    if ((typeof tasks !== 'object')) {
      return ctx.throw(400, new Error('Invalid object type'))
    }

    if (!Array.isArray(tasks)) {
      tasks = [tasks]
    }

    for (let task of tasks) {
      clusshCtx.addTask(task)
    }

    ctx.body = { success: true, count: tasks.length }
  })

  app.on('error', function (err) {
    clusshCtx.writeStream.log({ type: 'http-error', error: err.message })
  })

  app
    .use(router.routes())
    .use(router.allowedMethods())

  app.listen(portHttp)
}
