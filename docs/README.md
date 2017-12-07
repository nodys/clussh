# Clussh
[![Build Status](https://travis-ci.org/nodys/clussh.svg?branch=master)](https://travis-ci.org/nodys/clussh) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![Clussh on npm](https://img.shields.io/npm/v/clussh.svg)](https://www.npmjs.com/package/clussh)

Stream task execution, through ssh, to one or many host, one or many times, in parallel or in series.


<p align="center">
  <img src="https://nodys.github.io/clussh/img/clussh-shell.gif" alt="clussh">
</p>

## Features:

- Distribute tasks upon many hosts
- Stream task from stdin
- Stream task outputs and progression stats to ldjson stream
- Support scaling, parallel execution and retry, network failure and host unavailability

## Installation

```sh
npm install -g clussh
```

This will install three command-line cli:
- clussh       - The main command line
- clussh-board - A streamable clussh progress board
- clussh-log   - Pretty print clussh logs

*Pre-requirement: [NodeJS](https://nodejs.org/) and its awesome [universe](https://node.cool)*

## Usages & exemples

```sh
# Run "Hello $(hostname)" on the default worker ssh://yourusername@localhost
clussh

# Run given command on default worker
clussh --cmd 'echo "Hello world"'
clussh --cmd 'echo "Hello world"' --scale 10 # Teen times
clussh --cmd 'echo "Hello world"' --scale 10 --concurrency 2 # Two in parallel

# Run given bash script on default worker
clussh ./install.sh

# Run given bash script on to agents (with a concurrency of 2 for agent-b)
# (NB: for ssh cooking & baking reasons, the shell script must ends with an exit statement)
clussh -w ssh://user@agent-a.local -w ssh://user@agent-b.local?concurrency=2 ./runme.sh

# Pipe task from line delimited json stream
echo '
{ "id": "task-a", "cmd": "echo hello; sleep 1" }
{ "id": "task-b", "cmd": "echo hello; sleep 2", "scale": 10 }
{ "id": "task-c", "script": "./runme.sh", args: ["--option", "value"] }
{ "id": "task-d", "script": "./runme.sh", "worker": "ssh://only@on.host" }
' | clussh -w ssh://user@agent-a -w ssh://user@agent-b

# You can pipe infinite line delemited json stream (eg. event logs for a file wacher...)
infinite-stream | clussh

# Print human readable logs
clussh | clussh-log

# Print nice-looking progress board
clussh | clussh-board

# Print human readable logs
clussh | clussh-log

# Save logs for further exploration (and still display the board)
clussh | tee output.log | clussh-board
tail -f output.log | clussh-log   # Another console...
tail -f output.log | clussh-board # Another console...
tail -f output.log | ndjson-filter 'd.type === "fail"' | prettyldjson # Another console...
```


## Command line usage and configuration

```sh
clussh [options] [script filepath]

Options:
  --help             Show help                                         [boolean]
  --version          Show version number                               [boolean]
  --retry, -r        How many retry for each task          [number] [default: 0]
  --timeout, -t      Task timeout in millisecond or parseable ms time (eg. 1h,
                     2d or `3 days`)                   [string] [default: "10d"]
  --worker, -w       Repeatable worker uri list
                                   [array] [default: "ssh://yourusername@localhost"]
  --concurrency, -c  Concurrency per worker                [number] [default: 1]
  --scale, -s        Default scale                         [number] [default: 1]
  --cmd              Command to execute                                 [string]
  --script           Script to execute (please ensure proper exit)      [string]
```


Clussh can be configured with a `.clusshrc` file (see https://www.npmjs.com/package/rc)

```json
{
  "worker": [
    "ssh://master@agent-a.local",
    "ssh://master@agent-b.local",
    "ssh://master@agent-b.local?concurrency=2"
  ],
  "concurrency": 4,
  "retry": 10
}
```

Above, one worker uri overide the default clussh configuration using url query string (`?concurrency=2` for host `agent-b.local`). This will result in two workers for `agent-b.local`: one with the default concurrency (4) and another with a concurrency of 2.


## Log message format

Clussh output line delemited json stream consumable by `clussh-board` or `clussh-log` or any other line delemited json tools (see [prettyldjson](https://www.npmjs.com/package/prettyldjson) for pretty print and [ndjson-cli](https://www.npmjs.com/package/ndjson-cli) for map, reduce, filtering, etc.)

*TODO: Fields documentation & messages types*

## API

```js
const clussh = require('clussh')

const clusshStream = clussh({
  cmd: 'hello',
  worker: [ 'ssh://foo@bar.com', 'ssh://bar@foo.com' ],
  retry: 3,
  concurrency: 2
})

clusshStream.pipe(process.stdout)
```

---

License: [MIT](./LICENSE) - Novadiscovery
