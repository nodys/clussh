const miss = require('mississippi')
const split = require('split2')

// A leazy parser of ldjson stream
module.exports = function () {
  return miss.pipeline.obj(split(), miss.through.obj(function (line, enc, done) {
    try {
      if (line[0] === '{') { this.push(JSON.parse(line)) }
    } catch (ignore) {}
    done()
  }))
}
