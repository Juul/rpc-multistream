var rpc = require('../')
var test = require('tape')

// heartbeat example
// note that you can enable heartbeat on either end, or both, or neither
// if you enable heartbeat on both ends then they will both send out hearbeats
// and both wait for heartbeat responses

test('heartbeat', function (t) {
    var server = rpc()
    var client = rpc({}, {
        heartbeat: 500, // send heartbeat every 500 ms
        maxMissedBeats: 2.5 // if we don't get a response in 1250 ms then die
    })
    client.pipe(server).pipe(client)
    t.plan(4)
    client.on('heartbeat', function(timeInMilliseconds) {
        t.pass("Got heartbeat response at:", timeInMilliseconds)
    })
    client.on('death', function() {
        t.pass("Server died (stopped responding to heartbeat requests)")
        t.end()
    })
    client.on('methods', function(methods) {
        t.pass("connected")

        // make server stop responding to heartbeats
        setTimeout(function() {
            server.playDead()
        }, 1000)
    })
})
