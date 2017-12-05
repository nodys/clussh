/* eslint-env mocha */
/* eslint-disable no-unused-expressions */ /* for chai */

// Tip: Hey, u need a konami code to switch to level 3 ? try `npx mocha --inspect-brk`

const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const miss = require('mississippi')
const clussh = require('..')
const { expect } = chai // eslint-disable-line no-unused-vars
const makeMockExeca = require('./utils/mock-execa')
const runnerSsh = require('../lib/runner-ssh')

chai.use(chaiAsPromised)

describe('clussh', function () {
  this.timeout(10000)
  beforeEach(() => {
    // Reset runner's execa mocking (overideable in task)
    runnerSsh.execa = makeMockExeca()
  })

  async function run (input = [{}], config) {
    const runnerBuffer = []
    const outputBuffer = []

    config = Object.assign({
      runner: async function (task, worker, logger) {
        runnerBuffer.push(task)
        return runnerSsh(task, worker, logger)
      },
      timeout: '10s',
      worker: ['ssh://master@localhost']
    }, config || {})

    return new Promise((resolve, reject) => {
      miss.from.obj(input)
      .pipe(clussh(config))
      .pipe(miss.through.obj(function (data, enc, done) {
        outputBuffer.push(data)
        done()
      }))
      .on('finish', () => {
        const summary = outputBuffer.reduce((memo, r) => r.isSummary ? r : memo, null)
        resolve({ runnerBuffer, outputBuffer, summary })
      })
    })
  }

  it('Execute simple task', async function () {
    const { runnerBuffer, outputBuffer } = await run([{ id: 'test' }])
    expect(runnerBuffer.length).to.eql(1)
    const success = outputBuffer.filter(t => t.type === 'success')
    expect(success).to.have.length(1)
    expect(success[0]).to.have.property('hostname', 'localhost')
    expect(success[0]).to.have.property('time')
    expect(success[0]).to.have.property('task')
    expect(success[0].task).to.have.property('id', 'test')
    expect(success[0].task).to.have.property('uuid', 'test-00000000')
  })

  it('Execute many task', async function () {
    const { runnerBuffer, outputBuffer } = await run([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' }
    ])
    expect(runnerBuffer.length).to.eql(3)
    expect(outputBuffer.filter(t => t.type === 'success')).to.have.length(3)
  })

  it('Handle invalid execution', async function () {
    runnerSsh.execa = makeMockExeca({ code: 1 })
    const { runnerBuffer, outputBuffer, summary } = await run([{}])
    expect(runnerBuffer.length).to.eql(1)
    expect(outputBuffer.filter(t => t.type === 'fail')).to.have.length(1)
    expect(summary.progress).to.have.property('retry', 0)
    expect(summary.progress).to.have.property('success', 0)
    expect(summary.progress).to.have.property('error', 1)
  })

  it('Should retry invalid execution', async function () {
    let count = 0
    let retry = 10
    const { summary } = await run([{}], {
      retry: retry,
      runner: async function (task, worker, logger) {
        let code = count === retry ? 0 : 1
        count++
        runnerSsh.execa = makeMockExeca({ code })
        return runnerSsh(task, worker, logger)
      }
    })
    expect(summary.progress).to.have.property('success', 1)
    expect(summary.progress).to.have.property('retry', 10)
  })

  it('Should handle timeout execution', async function () {
    const { summary } = await run([{}], {
      timeout: 100,
      runner: () => new Promise(resolve => setTimeout(resolve, 1000))
    })
    expect(summary.progress).to.have.property('success', 0)
    expect(summary.progress).to.have.property('error', 1)
    expect(summary.progress).to.have.property('timeout', 1)
  })

  it('Should scale task', async function () {
    const { summary } = await run([{ scale: 10 }], { })
    expect(summary.progress).to.have.property('success', 10)
    expect(summary.progress).to.have.property('total', 10)
  })

  it('Should throw on invalid worker type', async function () {
    return expect(run([{}], {
      worker: ['local://test']
    })).to.be.rejected
  })

  it('Should distribute evenly task accross worker', async function () {
    const SIZE = 100

    const { summary, outputBuffer } = await run([{ scale: SIZE }], {
      worker: [
        'ssh://master@a.local',
        'ssh://master@b.local'
      ]
    })
    const a = outputBuffer
      .reduce((m, r) => ((r.type === 'dashboard-state') && (r.hostname === 'a.local')) ? r : m, null)
    const b = outputBuffer
      .reduce((m, r) => ((r.type === 'dashboard-state') && (r.hostname === 'b.local')) ? r : m, null)

    expect(summary.progress).to.have.property('total', SIZE)
    expect(a.progress.total + b.progress.total).to.eql(SIZE)
    expect(a.progress.done + b.progress.done).to.eql(SIZE)
    expect(a.progress.success + b.progress.success).to.eql(SIZE)

    // Proportional mean should be 1
    expect(Math.round(a.progress.total / b.progress.total))
      .to.eql(1, 'Expect more or less equal distribution between same kind of worker (same speed)')
  })

  it('Should distribute task accross worker according to their speed', async function () {
    const FRACT = 0.2
    const SIZE = 400

    const { outputBuffer } = await run([{ scale: SIZE }], {
      worker: [
        'ssh://master@a.local',
        'ssh://master@b.local'
      ],
      runner: async (task, worker) => {
        let duration = worker.server.hostname === 'a.local' ? 2 / FRACT : 2
        return new Promise(resolve => setTimeout(resolve, duration))
      }
    })
    const a = outputBuffer
      .reduce((m, r) => ((r.type === 'dashboard-state') && (r.hostname === 'a.local')) ? r : m, null)
    const b = outputBuffer
      .reduce((m, r) => ((r.type === 'dashboard-state') && (r.hostname === 'b.local')) ? r : m, null)

    // Proportional mean should be 1
    expect(Math.floor(a.progress.total / b.progress.total * 10))
      .to.eql(FRACT * 10, 'Expect distribution consistant with worker speed ratio')
  })

  it('Should handle server death', async function () {
    runnerSsh.execa = makeMockExeca({ code: 255 })
    const { summary, outputBuffer } = await run([{}], { timeout: '1s' })
    const workerState = outputBuffer
      .reduce((m, r) => ((r.type === 'dashboard-state') && (r.hostname === 'localhost')) ? r : m, null)
    expect(workerState)
      .to.have.property('down', true)
    expect(summary.progress)
      .to.have.property('error', 1)
  })

  it('should ping server waiting for it to revive', function () {

  })
})
